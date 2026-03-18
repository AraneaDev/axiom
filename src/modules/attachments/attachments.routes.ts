import { Router } from 'express';
import multer from 'multer';

import { authenticate } from '../../middleware/auth';

import * as controller from './attachments.controller';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

router.use(authenticate);

router.post('/', upload.single('file'), controller.upload);
router.get('/', controller.list);
router.get('/:id', controller.download);
router.get('/:id/meta', controller.getMeta);
router.delete('/:id', controller.remove);

export default router;
