import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as milestonesController from './milestones.controller';

const router = Router();

router.post('/:projectId/milestones', authenticate, milestonesController.create);
router.get('/:projectId/milestones', authenticate, milestonesController.list);
router.get('/milestones/:milestoneId', authenticate, milestonesController.get);
router.patch('/milestones/:milestoneId', authenticate, milestonesController.update);
router.delete('/milestones/:milestoneId', authenticate, milestonesController.remove);

export default router;
