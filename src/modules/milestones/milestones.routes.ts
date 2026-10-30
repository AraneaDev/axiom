import { Router } from 'express';

import { prisma } from '../../config/database';
import { authenticate } from '../../middleware/auth';
import {
  requireProjectAccess,
  requireProjectAccessVia,
} from '../../middleware/requireProjectAccess';
import { ERR } from '../../utils/error-messages';

import * as milestonesController from './milestones.controller';

const router = Router();

// Milestones by id: the user needs access to the milestone's project
const milestoneAccess = requireProjectAccessVia(
  'milestoneId',
  async (id) =>
    (await prisma.milestone.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  ERR.MILESTONE_NOT_FOUND,
);

router.post(
  '/:projectId/milestones',
  authenticate,
  requireProjectAccess,
  milestonesController.create,
);
router.get('/:projectId/milestones', authenticate, requireProjectAccess, milestonesController.list);
router.get('/milestones/:milestoneId', authenticate, milestoneAccess, milestonesController.get);
router.patch(
  '/milestones/:milestoneId',
  authenticate,
  milestoneAccess,
  milestonesController.update,
);
router.delete(
  '/milestones/:milestoneId',
  authenticate,
  milestoneAccess,
  milestonesController.remove,
);

export default router;
