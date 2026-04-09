import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireOrgPermission, requireTeamPermission } from '../../middleware/rbac';

import * as analyticsController from './analytics.controller';

const router = Router();

router.use(authenticate);

// Org-level analytics -- any org member can view
router.get(
  '/orgs/:orgId/analytics',
  requireOrgPermission('issue:view'),
  analyticsController.getOrgAnalytics,
);

// Team-level analytics -- any team member can view
router.get(
  '/teams/:teamId/analytics',
  requireTeamPermission('issue:view'),
  analyticsController.getTeamAnalytics,
);

export default router;
