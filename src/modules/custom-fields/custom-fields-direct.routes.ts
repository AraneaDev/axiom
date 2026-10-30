import { Router } from 'express';

import { prisma } from '../../config/database';
import { authenticate } from '../../middleware/auth';
import {
  requireProjectAccessVia,
  requireProjectWriteVia,
} from '../../middleware/requireProjectAccess';
import { ERR } from '../../utils/error-messages';

import * as customFieldsCtrl from './custom-fields.controller';

const router = Router();

router.use(authenticate);

// Field definitions and issue values belong to a project: the user needs access to it
const fieldProject = async (id: string) =>
  (await prisma.customFieldDefinition.findUnique({ where: { id }, select: { projectId: true } }))
    ?.projectId;
const issueProject = async (id: string) =>
  (await prisma.issue.findUnique({ where: { id }, select: { projectId: true } }))?.projectId;
// Reads need project access; writes also need issue:edit by role
const fieldAccess = [
  requireProjectAccessVia('fieldId', fieldProject, 'Custom field not found'),
  requireProjectWriteVia('fieldId', fieldProject),
];
// Changing a field definition is project configuration: team ADMINs and org OWNERs/ADMINs
const fieldSettings = [
  ...fieldAccess,
  requireProjectWriteVia('fieldId', fieldProject, 'team:manage_members'),
];
const issueAccess = [
  requireProjectAccessVia('issueId', issueProject, ERR.ISSUE_NOT_FOUND),
  requireProjectWriteVia('issueId', issueProject),
];

// Direct field definition routes (not project-scoped)
router.patch('/custom-fields/:fieldId', ...fieldSettings, customFieldsCtrl.updateDefinition);
router.delete('/custom-fields/:fieldId', ...fieldSettings, customFieldsCtrl.deleteDefinition);

// Issue custom field value routes
router.put(
  '/issues/:issueId/custom-fields/:fieldId',
  ...issueAccess,
  ...fieldAccess,
  customFieldsCtrl.setFieldValue,
);
router.get('/issues/:issueId/custom-fields', ...issueAccess, customFieldsCtrl.getFieldValues);

export default router;
