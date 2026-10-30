import { Router } from 'express';

import { prisma } from '../../config/database';
import { authenticate } from '../../middleware/auth';
import { requireProjectAccessVia } from '../../middleware/requireProjectAccess';
import { ERR } from '../../utils/error-messages';

import * as customFieldsCtrl from './custom-fields.controller';

const router = Router();

router.use(authenticate);

// Field definitions and issue values belong to a project: the user needs access to it
const fieldAccess = requireProjectAccessVia(
  'fieldId',
  async (id) =>
    (await prisma.customFieldDefinition.findUnique({ where: { id }, select: { projectId: true } }))
      ?.projectId,
  'Custom field not found',
);
const issueAccess = requireProjectAccessVia(
  'issueId',
  async (id) =>
    (await prisma.issue.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  ERR.ISSUE_NOT_FOUND,
);

// Direct field definition routes (not project-scoped)
router.patch('/custom-fields/:fieldId', fieldAccess, customFieldsCtrl.updateDefinition);
router.delete('/custom-fields/:fieldId', fieldAccess, customFieldsCtrl.deleteDefinition);

// Issue custom field value routes
router.put(
  '/issues/:issueId/custom-fields/:fieldId',
  issueAccess,
  fieldAccess,
  customFieldsCtrl.setFieldValue,
);
router.get('/issues/:issueId/custom-fields', issueAccess, customFieldsCtrl.getFieldValues);

export default router;
