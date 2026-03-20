import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireRepoAccess } from '../../middleware/rbac';

import * as webhooksController from './webhooks.controller';

const router = Router();

router.use(authenticate);

router.post('/:repoId/webhooks', requireRepoAccess(), webhooksController.create);
router.get('/:repoId/webhooks', requireRepoAccess(), webhooksController.list);
router.get('/:repoId/webhooks/:webhookId', requireRepoAccess(), webhooksController.get);
router.patch('/:repoId/webhooks/:webhookId', requireRepoAccess(), webhooksController.update);
router.delete('/:repoId/webhooks/:webhookId', requireRepoAccess(), webhooksController.remove);
router.get(
  '/:repoId/webhooks/:webhookId/deliveries',
  requireRepoAccess(),
  webhooksController.listDeliveries,
);
router.post(
  '/:repoId/webhooks/:webhookId/redeliver/:deliveryId',
  requireRepoAccess(),
  webhooksController.redeliver,
);

export default router;
