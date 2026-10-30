import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireOrgPermission, requireTeamMember } from '../../middleware/rbac';

import * as analyticsController from './analytics.controller';

const router = Router();

router.use(authenticate);

// Org-level analytics -- any org member can view
router.get(
  '/orgs/:orgId/analytics',
  requireOrgPermission('issue:view'),
  analyticsController.getOrgAnalytics,
);

// Team-level analytics -- team members (and org OWNER/ADMIN) can view
router.get('/teams/:teamId/analytics', requireTeamMember(), analyticsController.getTeamAnalytics);

export default router;
