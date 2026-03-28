import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import {
  requireTeamPermission,
  requireWikiSpaceAccess,
  requireWikiPageAccess,
  requireWikiCommentAccess,
  requireWikiTemplateAccess,
  requireWikiRestrictionAccess,
} from '../../middleware/rbac';

import * as analyticsController from './wiki-analytics.controller';
import * as commentsController from './wiki-comments.controller';
import * as hydrateController from './wiki-hydrate.controller';
import * as labelsController from './wiki-labels.controller';
import * as permController from './wiki-permissions.controller';
import * as starsController from './wiki-stars.controller';
import * as templatesController from './wiki-templates.controller';
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
router.patch('/spaces/:spaceId', requireWikiSpaceAccess(), wikiController.updateSpace);
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
  '/spaces/:spaceId/pages/:pageSlug/hydrate',
  requireWikiSpaceAccess(),
  hydrateController.hydrateWikiPage,
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
router.get(
  '/spaces/:spaceId/pages/:pageSlug/diff',
  requireWikiSpaceAccess(),
  wikiController.diffVersions,
);
router.post(
  '/spaces/:spaceId/pages/:pageSlug/restore',
  requireWikiSpaceAccess(),
  wikiController.restoreVersion,
);

// Templates (space-scoped require space access, template-scoped require template access)
router.post(
  '/spaces/:spaceId/templates',
  requireWikiSpaceAccess(),
  templatesController.createTemplate,
);
router.get(
  '/spaces/:spaceId/templates',
  requireWikiSpaceAccess(),
  templatesController.listTemplates,
);
router.get('/templates/:templateId', requireWikiTemplateAccess(), templatesController.getTemplate);
router.delete(
  '/templates/:templateId',
  requireWikiTemplateAccess(),
  templatesController.deleteTemplate,
);

// Page comments (require org membership via page lookup)
router.post('/pages/:pageId/comments', requireWikiPageAccess(), commentsController.addPageComment);
router.get('/pages/:pageId/comments', requireWikiPageAccess(), commentsController.listPageComments);
router.patch('/comments/:commentId', requireWikiCommentAccess(), commentsController.patchComment);
router.delete(
  '/comments/:commentId',
  requireWikiCommentAccess(),
  commentsController.deletePageComment,
);
router.post(
  '/comments/:commentId/reactions',
  requireWikiCommentAccess(),
  commentsController.toggleReaction,
);

// Page labels (require org membership via page lookup)
router.get('/pages/:pageId/labels', requireWikiPageAccess(), labelsController.listPageLabels);
router.post('/pages/:pageId/labels', requireWikiPageAccess(), labelsController.addPageLabel);
router.delete(
  '/pages/:pageId/labels/:label',
  requireWikiPageAccess(),
  labelsController.removePageLabel,
);
router.get('/spaces/:spaceId/labels', requireWikiSpaceAccess(), labelsController.searchByLabel);

// Page restrictions (require org membership via page lookup)
router.get('/pages/:pageId/restrictions', requireWikiPageAccess(), permController.getRestrictions);
router.put('/pages/:pageId/restrictions', requireWikiPageAccess(), permController.setRestrictions);
router.delete(
  '/restrictions/:restrictionId',
  requireWikiRestrictionAccess(),
  permController.removeRestriction,
);

// Move / Copy / Reorder (require org membership via page lookup)
router.post('/pages/:pageId/move', requireWikiPageAccess(), wikiController.movePage);
router.post('/pages/:pageId/copy', requireWikiPageAccess(), wikiController.copyPage);
router.patch('/pages/:pageId/reorder', requireWikiPageAccess(), wikiController.reorderPage);

// Starred pages
router.get('/starred', starsController.getStarredPages);
router.post('/pages/:pageId/star', requireWikiPageAccess(), starsController.toggleStar);
router.get('/pages/:pageId/star', requireWikiPageAccess(), starsController.checkStarred);

// Page analytics
router.post('/pages/:pageId/view', requireWikiPageAccess(), analyticsController.recordView);
router.get('/pages/:pageId/analytics', requireWikiPageAccess(), analyticsController.getAnalytics);

export default router;
