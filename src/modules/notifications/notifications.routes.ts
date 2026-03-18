import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as ctrl from './notifications.controller';

const router = Router();

router.use(authenticate);

router.get('/', ctrl.list);
router.get('/unread-count', ctrl.getCount);
router.patch('/:id/read', ctrl.markRead);
router.post('/read-all', ctrl.markAllRead);

export default router;
