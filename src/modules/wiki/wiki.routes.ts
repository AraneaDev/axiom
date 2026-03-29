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

import * as spacePermController from './space-permissions.controller';
import { requireSpacePermission } from './space-permissions.middleware';
import * as analyticsController from './wiki-analytics.controller';
import * as commentsController from './wiki-comments.controller';
import * as hydrateController from './wiki-hydrate.controller';
import * as linkController from './wiki-issue-links.controller';
import * as labelsController from './wiki-labels.controller';
import * as permController from './wiki-permissions.controller';
import * as starsController from './wiki-stars.controller';
import * as templateResolverController from './wiki-template-resolver.controller';
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

// Space operations (require org membership via space lookup + space permissions)
router.get(
  '/spaces/:spaceId',
  requireWikiSpaceAccess(),
  requireSpacePermission('VIEW'),
  wikiController.getSpace,
);
router.patch(
  '/spaces/:spaceId',
  requireWikiSpaceAccess(),
  requireSpacePermission('ADMIN'),
  wikiController.updateSpace,
);
router.get(
  '/spaces/:spaceId/tree',
  requireWikiSpaceAccess(),
  requireSpacePermission('VIEW'),
  wikiController.pageTree,
);

// Space permission management (require ADMIN level)
router.get(
  '/spaces/:spaceId/permissions',
  requireWikiSpaceAccess(),
  requireSpacePermission('ADMIN'),
  spacePermController.listPermissions,
);
router.put(
  '/spaces/:spaceId/permissions',
  requireWikiSpaceAccess(),
  requireSpacePermission('ADMIN'),
  spacePermController.upsertPermission,
);
router.delete(
  '/spaces/:spaceId/permissions/:permissionId',
  requireWikiSpaceAccess(),
  requireSpacePermission('ADMIN'),
  spacePermController.deletePermission,
);

// Pages (require org membership via space lookup + space permissions)
router.post(
  '/spaces/:spaceId/pages',
  requireWikiSpaceAccess(),
  requireSpacePermission('EDIT'),
  wikiController.createPage,
);
router.get(
  '/spaces/:spaceId/pages/:pageSlug',
  requireWikiSpaceAccess(),
  requireSpacePermission('VIEW'),
  wikiController.getPage,
);
router.patch(
  '/spaces/:spaceId/pages/:pageSlug',
  requireWikiSpaceAccess(),
  requireSpacePermission('EDIT'),
  wikiController.updatePage,
);
router.delete(
  '/spaces/:spaceId/pages/:pageSlug',
  requireWikiSpaceAccess(),
  requireSpacePermission('EDIT'),
  wikiController.deletePage,
);
router.get(
  '/spaces/:spaceId/pages/:pageSlug/hydrate',
  requireWikiSpaceAccess(),
  requireSpacePermission('VIEW'),
  hydrateController.hydrateWikiPage,
);
router.get(
  '/spaces/:spaceId/pages/:pageSlug/history',
  requireWikiSpaceAccess(),
  requireSpacePermission('VIEW'),
  wikiController.pageHistory,
);
router.get(
  '/spaces/:spaceId/pages/:pageSlug/export',
  requireWikiSpaceAccess(),
  requireSpacePermission('VIEW'),
  wikiController.exportPage,
);
router.get(
  '/spaces/:spaceId/pages/:pageSlug/diff',
  requireWikiSpaceAccess(),
  requireSpacePermission('VIEW'),
  wikiController.diffVersions,
);
router.post(
  '/spaces/:spaceId/pages/:pageSlug/restore',
  requireWikiSpaceAccess(),
  requireSpacePermission('EDIT'),
  wikiController.restoreVersion,
);

// Template variable resolution
router.post('/resolve-template', templateResolverController.resolveTemplate);

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
router.get(
  '/spaces/:spaceId/labels',
  requireWikiSpaceAccess(),
  requireSpacePermission('VIEW'),
  labelsController.searchByLabel,
);

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

// Wiki-Issue Links
router.get(
  '/pages/:pageId/linked-issues',
  requireWikiPageAccess(),
  linkController.listLinkedIssues,
);
router.post('/pages/:pageId/linked-issues', requireWikiPageAccess(), linkController.addLink);
router.delete(
  '/pages/:pageId/linked-issues/:issueId',
  requireWikiPageAccess(),
  linkController.removeLink,
);

export default router;
