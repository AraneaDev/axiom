import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream';

import { type Request, type RequestHandler, type Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer, { type FileFilterCallback, MulterError } from 'multer';

import { type RequestCtx, runWithRequestContext } from '../../lib/request-context';
import { createUserSlots } from '../../lib/user-slots';
import { auditMiddleware } from '../../middleware/auditMiddleware';
import { AppError } from '../../middleware/errorHandler';
import { signedUploadLimiter } from '../../middleware/rate-limit';
import { param } from '../../utils/params';

import {
  bareMimeType,
  isAllowedMimeType,
  MAX_ATTACHMENT_BYTES,
  MAX_FILENAME_LENGTH,
  mimeTypeRefusal,
} from './attachments.service';
import { newTempPath, receiveToTempFile, removeTempFile, type TempFile } from './temp-files';
import {
  assertUploadStillAllowed,
  findUsableIntent,
  storeSignedUpload,
} from './upload-intents.service';

function fileFilter(_req: Express.Request, file: Express.Multer.File, cb: FileFilterCallback) {
  if (file.originalname.length > MAX_FILENAME_LENGTH) {
    cb(new AppError(400, 'The file name is too long', 'BAD_UPLOAD'));
  } else if (isAllowedMimeType(file.mimetype)) {
    cb(null, true);
  } else {
    cb(mimeTypeRefusal(file.mimetype));
  }
}

/** The temp file of each multipart request, so that a failed one can be cleaned up. */
const tempFiles = new WeakMap<object, { path: string; out: fs.WriteStream }>();

/**
 * Disk storage that keeps hold of the file it writes. Multer only removes a temp file once it is
 * complete, so an aborted upload or a body without a closing boundary would stay behind, along
 * with its open write stream.
 */
const tempStorage: multer.StorageEngine = {
  _handleFile(req, file, cb) {
    const tempPath = newTempPath();
    const out = fs.createWriteStream(tempPath);
    tempFiles.set(req, { path: tempPath, out });
    pipeline(file.stream, out, (err) => {
      if (err) cb(err);
      else {
        cb(null, {
          destination: path.dirname(tempPath),
          filename: path.basename(tempPath),
          path: tempPath,
          size: out.bytesWritten,
        });
      }
    });
  },
  _removeFile(_req, file, cb) {
    fs.unlink(file.path, cb);
  },
};

const upload = multer({
  storage: tempStorage,
  // Busboy stops at this size, not past it, and a file of exactly the maximum is allowed
  limits: { fileSize: MAX_ATTACHMENT_BYTES + 1 },
  fileFilter,
});

/**
 * Remove what a refused multipart request left in the temp directory.
 * @param req - The request
 */
async function removeMultipartTemp(req: Request): Promise<void> {
  const temp = tempFiles.get(req);
  if (!temp) return;
  // Closed first: a stream still opening would create the file again after the unlink
  if (!temp.out.closed) {
    await new Promise((resolve) => {
      temp.out.once('close', resolve);
      temp.out.destroy();
    });
  }
  await removeTempFile(temp.path);
}

const uploadRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  // Runs inside a handler, which has to hear about the refusal instead of being left waiting
  handler: (_req, _res, next, options) => {
    next(new AppError(options.statusCode, 'Too many uploads, please try again later'));
  },
});

/**
 * Run a middleware inside a handler.
 * @param middleware - The middleware
 * @param req - The request
 * @param res - The response
 */
function runMiddleware(middleware: RequestHandler, req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    void middleware(req, res, (err?: unknown) => (err ? reject(err as Error) : resolve()));
  });
}

/**
 * What a client hears about a multipart body multer turned down. An error with a code is the
 * server's own (a full disk).
 * @param err - What multer gave
 */
function multipartRefusal(err: unknown): unknown {
  if (err instanceof MulterError) {
    return err.code === 'LIMIT_FILE_SIZE'
      ? new AppError(413, 'File is larger than 25 MB', 'FILE_TOO_LARGE')
      : new AppError(400, err.message, 'BAD_UPLOAD');
  }
  if (err instanceof AppError || (err as NodeJS.ErrnoException).code) return err;
  return new AppError(400, 'The upload could not be read', 'BAD_UPLOAD');
}

/**
 * Apply the upload rate limit and parse a multipart body into `req.file` and `req.body`. A file
 * left on disk after this is for the caller to store or remove.
 * @param req - The request
 * @param res - The response
 */
export async function receiveMultipart(req: Request, res: Response): Promise<void> {
  await runMiddleware(uploadRateLimit, req, res);
  // Multer also calls back like this when the client aborts: it listens for that itself
  await runMiddleware(upload.single('file'), req, res).catch(async (err: unknown) => {
    await removeMultipartTemp(req);
    throw multipartRefusal(err);
  });
}

/** How long a signed upload may take to send its body, however steadily it keeps sending. */
const BODY_READ_TIMEOUT_MS = 120_000;

/** Signed uploads one user can have running at once. */
export const MAX_CONCURRENT_SIGNED_PUTS_PER_USER = 4;
/** And all users together: each can put 25 MB on the temp disk, so at most 800 MB in all. */
export const MAX_CONCURRENT_SIGNED_PUTS = 32;
/** Seconds a refused client should wait: about what one upload takes. */
const SIGNED_PUT_RETRY_AFTER = '30';
const signedPutSlots = createUserSlots(
  MAX_CONCURRENT_SIGNED_PUTS_PER_USER,
  MAX_CONCURRENT_SIGNED_PUTS,
);

/**
 * Receive the raw body of a signed upload in a temp file, without inflating it: the limit is on
 * what gets stored.
 * @param req - The request
 * @param res - The response
 * @param limit - The most it may hold
 * @throws {AppError} 413 past the limit, 415 when it is compressed, 400 when it is empty or the
 * client goes away, 408 past the deadline
 */
async function receiveSignedBody(req: Request, res: Response, limit: number): Promise<TempFile> {
  const tooLarge = new AppError(
    413,
    'The file is larger than this upload URL allows',
    'FILE_TOO_LARGE',
  );
  // Unread, so Node discards the rest once the answer is out
  if (Number(req.headers['content-length']) > limit) throw tooLarge;
  const encoding = req.headers['content-encoding'];
  if (encoding && encoding.toLowerCase() !== 'identity') {
    throw new AppError(415, 'Compressed uploads are not supported');
  }
  return receiveToTempFile(req, {
    limit,
    timeoutMs: BODY_READ_TIMEOUT_MS,
    tooLarge,
    empty: new AppError(400, 'No file provided', 'MISSING_FILE'),
    interrupted: new AppError(400, 'The upload was interrupted', 'BAD_UPLOAD'),
    timedOut: new AppError(408, 'The upload took too long', 'UPLOAD_TIMEOUT'),
  }).catch((err: unknown) => {
    // The rest of this body is never read, so the connection can't serve another request
    res.setHeader('Connection', 'close');
    throw err;
  });
}

/**
 * Signed uploads. index.ts mounts this ahead of the JSON parser, the CSRF guard and require2fa:
 * the signature is the credential and there is no session a forged request could ride on. It is
 * one exact method and path, so every other request meets those as usual.
 *
 * The signature comes first and the body last, so that nobody can make the server write anything
 * without holding a valid URL. It answers for itself what authenticate and the audit middleware
 * would do for a request further down.
 */
export const signedUploadRouter = Router();

signedUploadRouter.put('/api/uploads/:uploadId', signedUploadLimiter, async (req, res) => {
  const intent = await findUsableIntent(param(req, 'uploadId'), req.query.sig);

  req.userId = intent.userId;
  const requestCtx: RequestCtx = {
    userId: intent.userId,
    apiTokenId: intent.apiToken?.id,
    apiTokenName: intent.apiToken?.name,
    channel: intent.apiToken ? 'rest-token' : 'ui',
  };
  await runWithRequestContext(requestCtx, async () => {
    auditMiddleware(req, res, () => {});

    // The type was signed for: anything else is refused rather than stored under the wrong one
    const sent = req.headers['content-type'];
    if (sent && bareMimeType(sent) !== intent.mimeType) throw mimeTypeRefusal(bareMimeType(sent));

    const busy = new AppError(
      429,
      'Too many uploads running, please try again later',
      'RATE_LIMITED',
    );
    await signedPutSlots
      .run(intent.userId, busy, async () => {
        await assertUploadStillAllowed(intent);
        const file = await receiveSignedBody(req, res, intent.maxBytes);
        res.status(201).json(await storeSignedUpload(intent, file));
      })
      .catch((err: unknown) => {
        if (err === busy) res.setHeader('Retry-After', SIGNED_PUT_RETRY_AFTER);
        throw err;
      });
  });
});
