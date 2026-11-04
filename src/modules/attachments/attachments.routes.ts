import fs from 'fs';
import path from 'path';

import express, { type Request, type RequestHandler, type Response, Router } from 'express';
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

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${unique}-${safeName}`);
    },
  }),
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
  fileFilter,
});

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
 * What a client hears about a multipart body multer turned down. Multer removes a partly written
 * temp file itself in all of these. An error with a code is the server's own (a full disk).
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
  await runMiddleware(upload.single('file'), req, res).catch((err: unknown) => {
    throw multipartRefusal(err);
  });
}

/**
 * Read the raw body, without inflating it: the limit is on what gets stored.
 * @param req - The request
 * @param res - The response
 * @param limit - The most it may hold
 * @throws {AppError} 413 past the limit, 415 when it is compressed, 400 when it is empty
 */
async function readRawBody(req: Request, res: Response, limit: number): Promise<Buffer> {
  const parser = express.raw({ type: () => true, limit, inflate: false });
  await runMiddleware(parser, req, res).catch((err: { type?: string; status?: number }) => {
    if (err.type === 'entity.too.large') {
      throw new AppError(413, 'The file is larger than this upload URL allows', 'FILE_TOO_LARGE');
    }
    if (err.type === 'encoding.unsupported') {
      throw new AppError(415, 'Compressed uploads are not supported');
    }
    if (err.status && err.status < 500) throw new AppError(err.status, 'The upload failed');
    throw err;
  });
  const body: unknown = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new AppError(400, 'No file provided', 'MISSING_FILE');
  }
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
