import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';

import * as templatesController from './issue-templates.controller';

const router = Router();

router.use(authenticate);
router.use('/:projectId/issue-templates', requireProjectAccess);

router.post('/:projectId/issue-templates', templatesController.create);
router.get('/:projectId/issue-templates', templatesController.list);
router.get('/:projectId/issue-templates/:templateId', templatesController.get);
router.patch('/:projectId/issue-templates/:templateId', templatesController.update);
router.delete('/:projectId/issue-templates/:templateId', templatesController.remove);

export default router;
