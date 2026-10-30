import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import {
  projectOf,
  requireProjectAccess,
  requireOwnedByProject,
  requireProjectWrite,
} from '../../middleware/requireProjectAccess';
import * as wikiLinkController from '../wiki/wiki-issue-links.controller';

import * as boardColumnsCtrl from './board-columns.controller';
import * as linksCtrl from './issue-links.controller';
import * as votesCtrl from './issue-votes.controller';
import * as watchersCtrl from './issue-watchers.controller';
import * as hydrateCtrl from './issues-hydrate.controller';
import * as issuesController from './issues.controller';

const router = Router();

router.use(authenticate);
// Writes follow the permission matrix: VIEWERs and GUESTs can read, not change
router.use('/:projectId', requireProjectWrite());
// Project settings: team ADMINs, org OWNERs/ADMINs and platform admins only
router.use('/:projectId/board/columns', requireProjectWrite('team:manage_members'));

router.use('/:projectId/issues', requireProjectAccess);
router.use('/:projectId/board', requireProjectAccess);
router.use('/:projectId/time-report', requireProjectAccess);
router.use('/:projectId/comments', requireProjectAccess);
router.use(
  '/:projectId/comments/:commentId',
  requireOwnedByProject('commentId', projectOf.comment),
);
router.use(
  '/:projectId/issues/:issueNumber/links/:linkId',
  requireOwnedByProject('linkId', projectOf.issueLink),
);

// All routes are scoped to a project
router.post('/:projectId/issues', issuesController.create);
router.get('/:projectId/issues', issuesController.list);
router.get('/:projectId/board', issuesController.board);

// Board column management
router.post('/:projectId/board/columns', boardColumnsCtrl.create);
router.patch('/:projectId/board/columns/reorder', boardColumnsCtrl.reorder);
router.patch('/:projectId/board/columns/:columnId', boardColumnsCtrl.update);
router.delete('/:projectId/board/columns/:columnId', boardColumnsCtrl.remove);

// Time report and CSV export (must come before :issueNumber routes)
router.get('/:projectId/time-report', issuesController.getTimeReport);
router.get('/:projectId/issues/export', issuesController.exportCsv);

// Bulk operations (must come before :issueNumber routes)
router.patch('/:projectId/issues/bulk', issuesController.bulkUpdate);

// Hydration endpoints (must come before :issueNumber routes)
router.get('/:projectId/issues/hydrate', hydrateCtrl.hydrateIssuesList);
router.get('/:projectId/issues/:issueNumber/hydrate', hydrateCtrl.hydrateIssueDetail);
router.get('/:projectId/issues/:issueNumber', issuesController.get);
router.patch('/:projectId/issues/:issueNumber', issuesController.update);
router.delete('/:projectId/issues/:issueNumber', issuesController.remove);

// Comments
router.post('/:projectId/issues/:issueNumber/comments', issuesController.addComment);
router.patch('/:projectId/comments/:commentId', issuesController.updateComment);
router.delete('/:projectId/comments/:commentId', issuesController.deleteComment);

// Worklogs (time tracking)
router.post('/:projectId/issues/:issueNumber/worklogs', issuesController.logWork);
router.get('/:projectId/issues/:issueNumber/worklogs', issuesController.getWorklogs);

// Issue links
router.get('/:projectId/issues/:issueNumber/links', linksCtrl.getLinks);
router.post('/:projectId/issues/:issueNumber/links', linksCtrl.addLink);
router.delete('/:projectId/issues/:issueNumber/links/:linkId', linksCtrl.deleteLink);

// Issue votes
router.post('/:projectId/issues/:issueNumber/votes/toggle', votesCtrl.toggle);
router.get('/:projectId/issues/:issueNumber/votes', votesCtrl.getVotes);

// Issue watchers
router.post('/:projectId/issues/:issueNumber/watchers/toggle', watchersCtrl.toggleWatch);
router.get('/:projectId/issues/:issueNumber/watchers', watchersCtrl.getWatchers);

// Board move
router.patch('/:projectId/issues/:issueNumber/move', issuesController.moveIssue);

// Hierarchy (parent/child)
router.patch('/:projectId/issues/:issueNumber/parent', issuesController.setParent);
router.get('/:projectId/issues/:issueNumber/children', issuesController.getChildren);
router.get('/:projectId/issues/:issueNumber/progress', issuesController.getProgress);

// Roadmap
router.use('/:projectId/roadmap', requireProjectAccess);
router.get('/:projectId/roadmap', issuesController.roadmap);

// Wiki links for issues
router.get(
  '/:projectId/issues/:issueNumber/wiki-links',
  wikiLinkController.listLinkedPagesForIssue,
);

export default router;
