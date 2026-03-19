import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import {
  requireTeamPermission,
  requireWikiSpaceAccess,
  requireWikiPageAccess,
  requireWikiCommentAccess,
  requireWikiTemplateAccess,
} from '../../middleware/rbac';

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

// Space operations (require org membership via space lookup)
router.get('/spaces/:spaceId', requireWikiSpaceAccess(), wikiController.getSpace);
router.get('/spaces/:spaceId/tree', requireWikiSpaceAccess(), wikiController.pageTree);

// Pages (require org membership via space lookup)
router.post('/spaces/:spaceId/pages', requireWikiSpaceAccess(), wikiController.createPage);
router.get('/spaces/:spaceId/pages/:pageSlug', requireWikiSpaceAccess(), wikiController.getPage);
router.patch(
  '/spaces/:spaceId/pages/:pageSlug',
  requireWikiSpaceAccess(),
  wikiController.updatePage,
);
router.delete(
  '/spaces/:spaceId/pages/:pageSlug',
  requireWikiSpaceAccess(),
  wikiController.deletePage,
);
router.get(
  '/spaces/:spaceId/pages/:pageSlug/history',
  requireWikiSpaceAccess(),
  wikiController.pageHistory,
);
router.get(
  '/spaces/:spaceId/pages/:pageSlug/export',
  requireWikiSpaceAccess(),
  wikiController.exportPage,
);

// Templates (space-scoped require space access, template-scoped require template access)
router.post('/spaces/:spaceId/templates', requireWikiSpaceAccess(), wikiController.createTemplate);
router.get('/spaces/:spaceId/templates', requireWikiSpaceAccess(), wikiController.listTemplates);
router.get('/templates/:templateId', requireWikiTemplateAccess(), wikiController.getTemplate);
router.delete('/templates/:templateId', requireWikiTemplateAccess(), wikiController.deleteTemplate);

// Page comments (require org membership via page lookup)
router.post('/pages/:pageId/comments', requireWikiPageAccess(), wikiController.addPageComment);
router.get('/pages/:pageId/comments', requireWikiPageAccess(), wikiController.listPageComments);
router.patch('/comments/:commentId', requireWikiCommentAccess(), wikiController.patchComment);
router.delete('/comments/:commentId', requireWikiCommentAccess(), wikiController.deletePageComment);

// Page labels (require org membership via page lookup)
router.get('/pages/:pageId/labels', requireWikiPageAccess(), wikiController.listPageLabels);
router.post('/pages/:pageId/labels', requireWikiPageAccess(), wikiController.addPageLabel);
router.delete(
  '/pages/:pageId/labels/:label',
  requireWikiPageAccess(),
  wikiController.removePageLabel,
);
router.get('/spaces/:spaceId/labels', requireWikiSpaceAccess(), wikiController.searchByLabel);

// Move / Copy (require org membership via page lookup)
router.post('/pages/:pageId/move', requireWikiPageAccess(), wikiController.movePage);
router.post('/pages/:pageId/copy', requireWikiPageAccess(), wikiController.copyPage);

export default router;
