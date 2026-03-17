import { Router } from 'express';
import * as webhooksController from './webhooks.controller';
import { authenticate } from '../../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/:repoId/webhooks', webhooksController.create);
router.get('/:repoId/webhooks', webhooksController.list);
router.get('/:repoId/webhooks/:webhookId', webhooksController.get);
router.patch('/:repoId/webhooks/:webhookId', webhooksController.update);
router.delete('/:repoId/webhooks/:webhookId', webhooksController.remove);

export default router;
