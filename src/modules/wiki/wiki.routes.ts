import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import {
  requireWikiSpaceAccess,
  requireWikiPageAccess,
  requireWikiPageBySlug,
  requireWikiCommentAccess,
  requireWikiTemplateAccess,
} from '../../middleware/rbac';

import { requireSpacePermission } from './space-permissions.middleware';
import * as analyticsController from './wiki-analytics.controller';
import * as commentsController from './wiki-comments.controller';
import * as labelsController from './wiki-labels.controller';
import * as starsController from './wiki-stars.controller';
import * as templatesController from './wiki-templates.controller';
import * as wikiController from './wiki.controller';

const router = Router();

router.use(authenticate);

// Pages (require org membership via space lookup + space permissions)
router.get(
  '/spaces/:spaceId/pages/:pageSlug/export',
  requireWikiSpaceAccess(),
  requireSpacePermission('VIEW'),
  requireWikiPageBySlug('view'),
  wikiController.exportPage,
);

// Templates (space-scoped require space access + permissions, template-scoped require template access)
router.post(
  '/spaces/:spaceId/templates',
  requireWikiSpaceAccess(),
  requireSpacePermission('EDIT'),
  templatesController.createTemplate,
);
router.get(
  '/spaces/:spaceId/templates',
  requireWikiSpaceAccess(),
  requireSpacePermission('VIEW'),
  templatesController.listTemplates,
);
router.get('/templates/:templateId', requireWikiTemplateAccess(), templatesController.getTemplate);
router.delete(
  '/templates/:templateId',
  requireWikiTemplateAccess('EDIT'),
  templatesController.deleteTemplate,
);

// Page comments (require org membership via page lookup)
router.post(
  '/pages/:pageId/comments',
  requireWikiPageAccess('view'),
  commentsController.addPageComment,
);
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
router.post('/pages/:pageId/labels', requireWikiPageAccess('edit'), labelsController.addPageLabel);
router.delete(
  '/pages/:pageId/labels/:label',
  requireWikiPageAccess('edit'),
  labelsController.removePageLabel,
);
router.get(
  '/spaces/:spaceId/labels',
  requireWikiSpaceAccess(),
  requireSpacePermission('VIEW'),
  labelsController.searchByLabel,
);

// Starred pages
router.get('/starred', starsController.getStarredPages);
router.post('/pages/:pageId/star', requireWikiPageAccess(), starsController.toggleStar);
router.get('/pages/:pageId/star', requireWikiPageAccess(), starsController.checkStarred);

// Page analytics
router.post('/pages/:pageId/view', requireWikiPageAccess(), analyticsController.recordView);
router.get('/pages/:pageId/analytics', requireWikiPageAccess(), analyticsController.getAnalytics);

export default router;
