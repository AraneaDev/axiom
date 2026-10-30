import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import {
  projectOf,
  requireProjectAccess,
  requireOwnedByProject,
  requireProjectWrite,
} from '../../middleware/requireProjectAccess';

import * as formsController from './forms.controller';

const router = Router();
router.use(authenticate);
// Writes follow the permission matrix: VIEWERs and GUESTs can read, not change
router.use('/:projectId', requireProjectWrite());
// Project settings: team ADMINs, org OWNERs/ADMINs and platform admins only
router.use('/:projectId/forms', requireProjectWrite('team:manage_members'));

// ─── Form CRUD ───────────────────────────────────────────────
router.get('/:projectId/forms', requireProjectAccess, formsController.list);
router.post('/:projectId/forms', requireProjectAccess, formsController.create);
router.get(
  '/:projectId/forms/:formId',
  requireProjectAccess,
  requireOwnedByProject('formId', projectOf.form),
  formsController.get,
);
router.patch(
  '/:projectId/forms/:formId',
  requireProjectAccess,
  requireOwnedByProject('formId', projectOf.form),
  formsController.update,
);
router.delete(
  '/:projectId/forms/:formId',
  requireProjectAccess,
  requireOwnedByProject('formId', projectOf.form),
  formsController.remove,
);
router.patch(
  '/:projectId/forms/:formId/publish',
  requireProjectAccess,
  requireOwnedByProject('formId', projectOf.form),
  formsController.publish,
);

// ─── Pages ───────────────────────────────────────────────────
router.post(
  '/:projectId/forms/:formId/pages',
  requireProjectAccess,
  requireOwnedByProject('formId', projectOf.form),
  formsController.createPage,
);
router.patch(
  '/:projectId/forms/:formId/pages/:pageId',
  requireProjectAccess,
  requireOwnedByProject('formId', projectOf.form),
  requireOwnedByProject('pageId', projectOf.formPage),
  formsController.updatePage,
);
router.delete(
  '/:projectId/forms/:formId/pages/:pageId',
  requireProjectAccess,
  requireOwnedByProject('formId', projectOf.form),
  requireOwnedByProject('pageId', projectOf.formPage),
  formsController.removePage,
);
router.post(
  '/:projectId/forms/:formId/pages/reorder',
  requireProjectAccess,
  requireOwnedByProject('formId', projectOf.form),
  formsController.reorderPages,
);

// ─── Fields ──────────────────────────────────────────────────
router.post(
  '/:projectId/forms/:formId/pages/:pageId/fields',
  requireProjectAccess,
  requireOwnedByProject('formId', projectOf.form),
  requireOwnedByProject('pageId', projectOf.formPage),
  formsController.createField,
);
router.patch(
  '/:projectId/forms/:formId/pages/:pageId/fields/:fieldId',
  requireProjectAccess,
  requireOwnedByProject('formId', projectOf.form),
  requireOwnedByProject('pageId', projectOf.formPage),
  requireOwnedByProject('fieldId', projectOf.formField),
  formsController.updateField,
);
router.delete(
  '/:projectId/forms/:formId/pages/:pageId/fields/:fieldId',
  requireProjectAccess,
  requireOwnedByProject('formId', projectOf.form),
  requireOwnedByProject('pageId', projectOf.formPage),
  requireOwnedByProject('fieldId', projectOf.formField),
  formsController.removeField,
);
router.post(
  '/:projectId/forms/:formId/fields/reorder',
  requireProjectAccess,
  requireOwnedByProject('formId', projectOf.form),
  formsController.reorderFields,
);

export default router;
