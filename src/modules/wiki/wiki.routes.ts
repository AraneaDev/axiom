import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import {
  requireTeamMember,
  requireTeamPermission,
  requireWikiSpaceAccess,
  requireWikiPageAccess,
  requireWikiPageBySlug,
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
  // Creating in a team needs what reading it needs (team membership), then the role
  requireTeamMember(),
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
  requireWikiPageBySlug('view'),
  wikiController.getPage,
);
router.patch(
  '/spaces/:spaceId/pages/:pageSlug',
  requireWikiSpaceAccess(),
  requireSpacePermission('EDIT'),
  requireWikiPageBySlug('edit'),
  wikiController.updatePage,
);
router.post(
  '/spaces/:spaceId/pages/:pageSlug/collab/flush',
  requireWikiSpaceAccess(),
  requireSpacePermission('EDIT'),
  requireWikiPageBySlug('edit'),
  wikiController.flushPageSession,
);
router.get(
  '/spaces/:spaceId/pages/:pageSlug/pending-merge',
  requireWikiSpaceAccess(),
  requireSpacePermission('EDIT'),
  requireWikiPageBySlug('edit'),
  wikiController.getPendingMerge,
);
router.post(
  '/spaces/:spaceId/pages/:pageSlug/merge',
  requireWikiSpaceAccess(),
  requireSpacePermission('EDIT'),
  requireWikiPageBySlug('edit'),
  wikiController.applyMerge,
);
router.delete(
  '/spaces/:spaceId/pages/:pageSlug',
  requireWikiSpaceAccess(),
  requireSpacePermission('EDIT'),
  requireWikiPageBySlug('edit'),
  wikiController.deletePage,
);
router.get(
  '/spaces/:spaceId/pages/:pageSlug/hydrate',
  requireWikiSpaceAccess(),
  requireSpacePermission('VIEW'),
  requireWikiPageBySlug('view'),
  hydrateController.hydrateWikiPage,
);
router.get(
  '/spaces/:spaceId/pages/:pageSlug/history',
  requireWikiSpaceAccess(),
  requireSpacePermission('VIEW'),
  requireWikiPageBySlug('view'),
  wikiController.pageHistory,
);
router.get(
  '/spaces/:spaceId/pages/:pageSlug/export',
  requireWikiSpaceAccess(),
  requireSpacePermission('VIEW'),
  requireWikiPageBySlug('view'),
  wikiController.exportPage,
);
router.get(
  '/spaces/:spaceId/pages/:pageSlug/diff',
  requireWikiSpaceAccess(),
  requireSpacePermission('VIEW'),
  requireWikiPageBySlug('view'),
  wikiController.diffVersions,
);
router.post(
  '/spaces/:spaceId/pages/:pageSlug/restore',
  requireWikiSpaceAccess(),
  requireSpacePermission('EDIT'),
  requireWikiPageBySlug('edit'),
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

// Page restrictions (require org membership via page lookup)
router.get('/pages/:pageId/restrictions', requireWikiPageAccess(), permController.getRestrictions);
router.put(
  '/pages/:pageId/restrictions',
  requireWikiPageAccess('edit'),
  permController.setRestrictions,
);
router.delete(
  '/restrictions/:restrictionId',
  requireWikiRestrictionAccess(),
  permController.removeRestriction,
);

// Move / Copy / Reorder (require org membership via page lookup)
router.post('/pages/:pageId/move', requireWikiPageAccess('edit'), wikiController.movePage);
router.post('/pages/:pageId/copy', requireWikiPageAccess('view'), wikiController.copyPage);
router.patch('/pages/:pageId/reorder', requireWikiPageAccess('edit'), wikiController.reorderPage);

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
router.post('/pages/:pageId/linked-issues', requireWikiPageAccess('edit'), linkController.addLink);
router.delete(
  '/pages/:pageId/linked-issues/:issueId',
  requireWikiPageAccess('edit'),
  linkController.removeLink,
);

export default router;
