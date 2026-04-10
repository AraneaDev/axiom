import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';

import * as formsController from './forms.controller';

const router = Router();
router.use(authenticate);

// ─── Form CRUD ───────────────────────────────────────────────
router.get('/:projectId/forms', requireProjectAccess, formsController.list);
router.post('/:projectId/forms', requireProjectAccess, formsController.create);
router.get('/:projectId/forms/:formId', requireProjectAccess, formsController.get);
router.patch('/:projectId/forms/:formId', requireProjectAccess, formsController.update);
router.delete('/:projectId/forms/:formId', requireProjectAccess, formsController.remove);
router.patch('/:projectId/forms/:formId/publish', requireProjectAccess, formsController.publish);

// ─── Pages ───────────────────────────────────────────────────
router.post('/:projectId/forms/:formId/pages', requireProjectAccess, formsController.createPage);
router.patch(
  '/:projectId/forms/:formId/pages/:pageId',
  requireProjectAccess,
  formsController.updatePage,
);
router.delete(
  '/:projectId/forms/:formId/pages/:pageId',
  requireProjectAccess,
  formsController.removePage,
);
router.post(
  '/:projectId/forms/:formId/pages/reorder',
  requireProjectAccess,
  formsController.reorderPages,
);

// ─── Fields ──────────────────────────────────────────────────
router.post(
  '/:projectId/forms/:formId/pages/:pageId/fields',
  requireProjectAccess,
  formsController.createField,
);
router.patch(
  '/:projectId/forms/:formId/pages/:pageId/fields/:fieldId',
  requireProjectAccess,
  formsController.updateField,
);
router.delete(
  '/:projectId/forms/:formId/pages/:pageId/fields/:fieldId',
  requireProjectAccess,
  formsController.removeField,
);
router.post(
  '/:projectId/forms/:formId/fields/reorder',
  requireProjectAccess,
  formsController.reorderFields,
);

export default router;
