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
router.get('/:projectId/issues/:issueNumber', issuesController.get);
router.patch('/:projectId/issues/:issueNumber', issuesController.update);
router.delete('/:projectId/issues/:issueNumber', issuesController.remove);

// Comments
router.post('/:projectId/issues/:issueNumber/comments', issuesController.addComment);

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

export default router;
