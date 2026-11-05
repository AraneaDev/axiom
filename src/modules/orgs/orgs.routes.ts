import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireOrgMember, requireOrgPermission } from '../../middleware/rbac';

import * as orgsController from './orgs.controller';

const router = Router();

router.use(authenticate);

// Orgs and their members run through the registry, but for reading the member list (members only:
// it has emails) and invite links
router.get('/:orgId/members', requireOrgMember(), orgsController.listMembers);

// Invite Links
router.post(
  '/:orgId/invites',
  requireOrgPermission('team:manage_members'),
  orgsController.createInvite,
);
router.get(
  '/:orgId/invites',
  requireOrgPermission('team:manage_members'),
  orgsController.listInvites,
);
router.delete(
  '/:orgId/invites/:inviteId',
  requireOrgPermission('team:manage_members'),
  orgsController.deleteInvite,
);

export default router;
