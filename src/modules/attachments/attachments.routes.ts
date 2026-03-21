import fs from 'fs';
import path from 'path';

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer, { FileFilterCallback } from 'multer';

import { authenticate } from '../../middleware/auth';

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
    cb(new Error(`File type ${file.mimetype} is not allowed`));
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

router.post('/', uploadRateLimit, upload.single('file'), controller.upload);
router.get('/', controller.list);
router.get('/:id/meta', controller.getMeta);
router.get('/:id/preview', controller.preview);
router.get('/:id/convert', controller.convertToMarkdown);
router.get('/:id', controller.download);
router.delete('/:id', controller.remove);

export default router;
