import { Router } from 'express';
import * as orgsController from './orgs.controller';
import { authenticate } from '../../middleware/auth';
import { requireOrgPermission } from '../../middleware/rbac';

const router = Router();

router.use(authenticate);

router.post('/', orgsController.create);
router.get('/', orgsController.list);
router.get('/:orgId', orgsController.get);
router.patch('/:orgId', requireOrgPermission('org:manage'), orgsController.update);
router.delete('/:orgId', requireOrgPermission('org:manage'), orgsController.remove);

// Members
router.post('/:orgId/members', requireOrgPermission('team:manage_members'), orgsController.addMember);
router.patch('/:orgId/members/:memberId', requireOrgPermission('team:manage_members'), orgsController.updateMemberRole);
router.delete('/:orgId/members/:memberId', requireOrgPermission('team:manage_members'), orgsController.removeMember);

// Invite Links
router.post('/:orgId/invites', requireOrgPermission('team:manage_members'), orgsController.createInvite);
router.get('/:orgId/invites', requireOrgPermission('team:manage_members'), orgsController.listInvites);
router.delete('/:orgId/invites/:inviteId', requireOrgPermission('team:manage_members'), orgsController.deleteInvite);

export default router;
