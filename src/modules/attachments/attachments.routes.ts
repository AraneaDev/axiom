import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream';

import { type Request, type RequestHandler, type Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer, { type FileFilterCallback, MulterError } from 'multer';

import { type RequestCtx, runWithRequestContext } from '../../lib/request-context';
import { auditMiddleware } from '../../middleware/auditMiddleware';
import { AppError } from '../../middleware/errorHandler';
import { signedUploadLimiter } from '../../middleware/rate-limit';
import { param } from '../../utils/params';

import {
  bareMimeType,
  isAllowedMimeType,
  MAX_ATTACHMENT_BYTES,
  mimeTypeRefusal,
} from './attachments.service';
import {
  assertUploadStillAllowed,
  findUsableIntent,
  storeSignedUpload,
} from './upload-intents.service';

const UPLOAD_DIR = '/tmp/uploads';
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function fileFilter(_req: Express.Request, file: Express.Multer.File, cb: FileFilterCallback) {
  if (isAllowedMimeType(file.mimetype)) {
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
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${unique}-${safeName}`;
    const tempPath = path.join(UPLOAD_DIR, filename);
    const out = fs.createWriteStream(tempPath);
    tempFiles.set(req, { path: tempPath, out });
    pipeline(file.stream, out, (err) => {
      if (err) cb(err);
      else {
        cb(null, {
          destination: UPLOAD_DIR,
          filename,
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
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
  fileFilter,
});

/**
 * Remove what a refused multipart request left in the temp directory.
 * @param req - The request
 */
async function removeTempFile(req: Request): Promise<void> {
  const temp = tempFiles.get(req);
  if (!temp) return;
  // Closed first: a stream still opening would create the file again after the unlink
  if (!temp.out.closed) {
    await new Promise((resolve) => {
      temp.out.once('close', resolve);
      temp.out.destroy();
    });
  }
  await fs.promises.unlink(temp.path).catch(() => {});
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
    await removeTempFile(req);
    throw multipartRefusal(err);
  });
}

/** How long a signed upload may take to send its body, however steadily it keeps sending. */
const BODY_READ_TIMEOUT_MS = 120_000;

/**
 * Read a request body into memory, refusing as soon as it can't succeed: past the limit, or past
 * the deadline. A parser would wait for the end of the body first, which a chunked body doesn't
 * have to reach.
 * @param req - The request
 * @param limit - The most it may hold
 * @param timeoutMs - How long it may take
 * @throws {AppError} 413 past the limit, 408 past the deadline, 400 when the client goes away
 */
export function readLimitedBody(req: Request, limit: number, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    const stop = () => {
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onGone);
      req.off('close', onGone);
    };
    const refuse = (err: AppError) => {
      stop();
      req.pause();
      reject(err);
    };
    const onData = (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        refuse(
          new AppError(413, 'The file is larger than this upload URL allows', 'FILE_TOO_LARGE'),
        );
      } else {
        chunks.push(chunk);
      }
    };
    const onEnd = () => {
      stop();
      resolve(Buffer.concat(chunks));
    };
    const onGone = () => refuse(new AppError(400, 'The upload was interrupted', 'BAD_UPLOAD'));
    const timer = setTimeout(
      () => refuse(new AppError(408, 'The upload took too long', 'UPLOAD_TIMEOUT')),
      timeoutMs,
    );

    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onGone);
    req.once('close', onGone);
  });
}

/**
 * Read the raw body of a signed upload, without inflating it: the limit is on what gets stored.
 * @param req - The request
 * @param res - The response
 * @param limit - The most it may hold
 * @throws {AppError} 413 past the limit, 415 when it is compressed, 400 when it is empty, 408
 */
async function readRawBody(req: Request, res: Response, limit: number): Promise<Buffer> {
  // Unread, so Node discards the rest once the answer is out
  if (Number(req.headers['content-length']) > limit) {
    throw new AppError(413, 'The file is larger than this upload URL allows', 'FILE_TOO_LARGE');
  }
  const encoding = req.headers['content-encoding'];
  if (encoding && encoding.toLowerCase() !== 'identity') {
    throw new AppError(415, 'Compressed uploads are not supported');
  }
  const body = await readLimitedBody(req, limit, BODY_READ_TIMEOUT_MS).catch((err: unknown) => {
    // The rest of this body is never read, so the connection can't serve another request
    res.setHeader('Connection', 'close');
    throw err;
  });
  if (body.length === 0) throw new AppError(400, 'No file provided', 'MISSING_FILE');
  return body;
}

/**
 * Signed uploads. index.ts mounts this ahead of the JSON parser, the CSRF guard and require2fa:
 * the signature is the credential and there is no session a forged request could ride on. It is
 * one exact method and path, so every other request meets those as usual.
 *
 * The signature comes first and the body last, so that nobody can make the server buffer 25 MB
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

    await assertUploadStillAllowed(intent);
    const data = await readRawBody(req, res, intent.maxBytes);
    res.status(201).json(await storeSignedUpload(intent, data));
  });
});
