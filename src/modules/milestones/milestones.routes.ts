import { Router } from 'express';

import { prisma } from '../../config/database';
import { authenticate } from '../../middleware/auth';
import {
  requireProjectAccess,
  requireProjectAccessVia,
  requireProjectWrite,
  requireProjectWriteVia,
} from '../../middleware/requireProjectAccess';
import { ERR } from '../../utils/error-messages';

import * as milestonesController from './milestones.controller';

const router = Router();

// Writes follow the permission matrix: VIEWERs and GUESTs can read, not change
router.use('/:projectId', authenticate, requireProjectWrite());

// Milestones by id: the user needs access to the milestone's project
const milestoneProject = async (id: string) =>
  (await prisma.milestone.findUnique({ where: { id }, select: { projectId: true } }))?.projectId;
const milestoneAccess = [
  requireProjectAccessVia('milestoneId', milestoneProject, ERR.MILESTONE_NOT_FOUND),
  requireProjectWriteVia('milestoneId', milestoneProject),
];

router.post(
  '/:projectId/milestones',
  authenticate,
  requireProjectAccess,
  milestonesController.create,
);
router.get('/:projectId/milestones', authenticate, requireProjectAccess, milestonesController.list);
router.get('/milestones/:milestoneId', authenticate, ...milestoneAccess, milestonesController.get);
router.patch(
  '/milestones/:milestoneId',
  authenticate,
  ...milestoneAccess,
  milestonesController.update,
);
router.delete(
  '/milestones/:milestoneId',
  authenticate,
  ...milestoneAccess,
  milestonesController.remove,
);

export default router;
