import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireTeamPermission } from '../../middleware/rbac';

import * as wikiController from './wiki.controller';

const router = Router();

router.use(authenticate);

// Wiki spaces (scoped to team)
router.post(
  '/team/:teamId/spaces',
  requireTeamPermission('wiki:create_space'),
  wikiController.createSpace,
);
router.get('/team/:teamId/spaces', requireTeamPermission('wiki:view'), wikiController.listSpaces);

// Space operations
router.get('/spaces/:spaceId', wikiController.getSpace);
router.get('/spaces/:spaceId/tree', wikiController.pageTree);

// Pages
router.post('/spaces/:spaceId/pages', wikiController.createPage);
router.get('/spaces/:spaceId/pages/:pageSlug', wikiController.getPage);
router.patch('/spaces/:spaceId/pages/:pageSlug', wikiController.updatePage);
router.delete('/spaces/:spaceId/pages/:pageSlug', wikiController.deletePage);
router.get('/spaces/:spaceId/pages/:pageSlug/history', wikiController.pageHistory);
router.get('/spaces/:spaceId/pages/:pageSlug/export', wikiController.exportPage);

// Templates
router.post('/spaces/:spaceId/templates', wikiController.createTemplate);
router.get('/spaces/:spaceId/templates', wikiController.listTemplates);
router.get('/templates/:templateId', wikiController.getTemplate);
router.delete('/templates/:templateId', wikiController.deleteTemplate);

// Page comments
router.post('/pages/:pageId/comments', wikiController.addPageComment);
router.get('/pages/:pageId/comments', wikiController.listPageComments);
router.patch('/comments/:commentId', wikiController.resolveComment);
router.delete('/comments/:commentId', wikiController.deletePageComment);

// Page labels
router.post('/pages/:pageId/labels', wikiController.addPageLabel);
router.delete('/pages/:pageId/labels/:label', wikiController.removePageLabel);
router.get('/spaces/:spaceId/labels', wikiController.searchByLabel);

// Move / Copy
router.post('/pages/:pageId/move', wikiController.movePage);
router.post('/pages/:pageId/copy', wikiController.copyPage);

export default router;
