import fs from 'fs';
import path from 'path';

import { NextFunction, Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer, { FileFilterCallback } from 'multer';

import { prisma } from '../../config/database';
import { authenticate } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { scopesCover } from '../../middleware/token-scopes';

import * as controller from './attachments.controller';

const router = Router();

const UPLOAD_DIR = '/tmp/uploads';
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIME_PATTERNS = [
  /^image\//,
  /^application\/pdf$/,
  /^application\/msword$/,
  /^application\/vnd\.openxmlformats-officedocument\./,
  /^text\/plain$/,
  /^text\/csv$/,
  /^application\/zip$/,
  /^application\/x-tar$/,
  /^application\/gzip$/,
];

function fileFilter(_req: Express.Request, file: Express.Multer.File, cb: FileFilterCallback) {
  const allowed = ALLOWED_MIME_PATTERNS.some((pattern) => pattern.test(file.mimetype));
  if (allowed) {
    cb(null, true);
  } else {
    cb(new AppError(415, `File type ${file.mimetype} is not allowed`));
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
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter,
});

const uploadRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: { error: { message: 'Too many uploads, please try again later' } },
});

router.use(authenticate);

/**
 * For API tokens: an attachment belongs to an issue or a page, so on top of the files scope
 * (checked by the path rules) the token needs the issues or wiki scope that covers it (read
 * to read, write to upload or delete). Session requests pass. Runs after multer on upload so the body is parsed.
 * @param req
 * @param _res
 * @param next
 */
async function requireParentScope(req: Request, _res: Response, next: NextFunction) {
  try {
    const scopes = req.tokenScopes;
    if (!scopes) return next();
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    let parent: { issueId?: string | null; pageId?: string | null } = {};
    if (req.params.id) {
      parent =
        (await prisma.attachment.findUnique({
          where: { id: String(req.params.id) },
          select: { issueId: true, pageId: true },
        })) ?? {};
    } else {
      const source = (write ? req.body : req.query) as Record<string, unknown>;
      parent = {
        issueId: typeof source.issueId === 'string' ? source.issueId : undefined,
        pageId: typeof source.pageId === 'string' ? source.pageId : undefined,
      };
    }
    const ok =
      (!parent.issueId || scopesCover(scopes, 'issues', write)) &&
      (!parent.pageId || scopesCover(scopes, 'wiki', write));
    if (!ok) {
      // Refused after multer stored the upload: drop the temp file
      if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {});
      return next(
        new AppError(403, 'This API token does not have the scope for this attachment', 'SCOPE'),
      );
    }
    next();
  } catch (err) {
    next(err);
  }
}

router.post('/', uploadRateLimit, upload.single('file'), requireParentScope, controller.upload);
router.get('/', requireParentScope, controller.list);
router.get('/:id/meta', requireParentScope, controller.getMeta);
router.get('/:id/preview', requireParentScope, controller.preview);
router.get('/:id/convert', requireParentScope, controller.convertToMarkdown);
router.get('/:id', requireParentScope, controller.download);
router.delete('/:id', requireParentScope, controller.remove);

export default router;
