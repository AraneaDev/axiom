import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireOrgPermission } from '../../middleware/rbac';

import * as invitationsController from './invitations.controller';

const router = Router();

router.use(authenticate);

// Org-scoped invitation management
router.post(
  '/orgs/:orgId/invitations',
  requireOrgPermission('team:manage_members'),
  invitationsController.create,
);
router.get(
  '/orgs/:orgId/invitations',
  requireOrgPermission('team:manage_members'),
  invitationsController.list,
);
router.delete(
  '/orgs/:orgId/invitations/:id',
  requireOrgPermission('team:manage_members'),
  invitationsController.revoke,
);

// Accept invitation (any authenticated user)
router.post('/invitations/:token/accept', invitationsController.accept);

export default router;
