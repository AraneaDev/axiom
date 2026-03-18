import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';

import * as branchesCtrl from './issue-branches.controller';
import * as commitsCtrl from './issue-commits.controller';
import * as linksCtrl from './issue-links.controller';
import * as issuesController from './issues.controller';

const router = Router();

router.use(authenticate);
router.use('/:projectId/issues', requireProjectAccess);
router.use('/:projectId/board', requireProjectAccess);

// All routes are scoped to a project
router.post('/:projectId/issues', issuesController.create);
router.get('/:projectId/issues', issuesController.list);
router.get('/:projectId/board', issuesController.board);

// Bulk operations (must come before :issueNumber routes)
router.patch('/:projectId/issues/bulk', issuesController.bulkUpdate);

router.get('/:projectId/issues/:issueNumber', issuesController.get);
router.patch('/:projectId/issues/:issueNumber', issuesController.update);
router.delete('/:projectId/issues/:issueNumber', issuesController.remove);

// Comments
router.post('/:projectId/issues/:issueNumber/comments', issuesController.addComment);

// Worklogs (time tracking)
router.post('/:projectId/issues/:issueNumber/worklogs', issuesController.logWork);
router.get('/:projectId/issues/:issueNumber/worklogs', issuesController.getWorklogs);

// Issue links
router.get('/:projectId/issues/:issueNumber/links', linksCtrl.getLinks);
router.post('/:projectId/issues/:issueNumber/links', linksCtrl.addLink);
router.delete('/:projectId/issues/:issueNumber/links/:linkId', linksCtrl.deleteLink);

// Issue commits
router.get('/:projectId/issues/:issueNumber/commits', commitsCtrl.getCommits);

// Issue branches
router.get('/:projectId/issues/:issueNumber/branches/suggest', branchesCtrl.getSuggestedName);
router.get('/:projectId/issues/:issueNumber/branches', branchesCtrl.getBranches);
router.post('/:projectId/issues/:issueNumber/branches', branchesCtrl.createBranch);

// Issue pull requests
router.get('/:projectId/issues/:issueNumber/pull-requests', issuesController.listPullRequests);

// Board move
router.patch('/:projectId/issues/:issueNumber/move', issuesController.moveIssue);

// Hierarchy (parent/child)
router.patch('/:projectId/issues/:issueNumber/parent', issuesController.setParent);
router.get('/:projectId/issues/:issueNumber/children', issuesController.getChildren);
router.get('/:projectId/issues/:issueNumber/progress', issuesController.getProgress);

// Roadmap
router.use('/:projectId/roadmap', requireProjectAccess);
router.get('/:projectId/roadmap', issuesController.roadmap);

export default router;
