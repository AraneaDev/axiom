import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireRepoAccess } from '../../middleware/rbac';

import * as pullsController from './pulls.controller';

const router = Router();

router.use(authenticate);

// PR CRUD (all repo-scoped -- require org membership via repo lookup)
router.post('/:repoId/pulls', requireRepoAccess(), pullsController.create);
router.get('/:repoId/pulls', requireRepoAccess(), pullsController.list);
router.get('/:repoId/pulls/:number', requireRepoAccess(), pullsController.get);
router.patch('/:repoId/pulls/:number', requireRepoAccess(), pullsController.update);
router.post('/:repoId/pulls/:number/close', requireRepoAccess(), pullsController.close);
router.post('/:repoId/pulls/:number/merge', requireRepoAccess(), pullsController.merge);
router.get('/:repoId/pulls/:number/merge-checks', requireRepoAccess(), pullsController.mergeChecks);

// PR diff and commits
router.get('/:repoId/pulls/:number/diff', requireRepoAccess(), pullsController.getDiff);
router.get('/:repoId/pulls/:number/commits', requireRepoAccess(), pullsController.getCommits);

// Linked issues
router.get('/:repoId/pulls/:number/issues', requireRepoAccess(), pullsController.getLinkedIssues);

// Reviews
router.post('/:repoId/pulls/:number/reviews', requireRepoAccess(), pullsController.submitReview);
router.get('/:repoId/pulls/:number/reviews', requireRepoAccess(), pullsController.listReviews);

// PR Comments (general + inline)
router.post('/:repoId/pulls/:number/comments', requireRepoAccess(), pullsController.addComment);
router.get('/:repoId/pulls/:number/comments', requireRepoAccess(), pullsController.listComments);

// Suggestions
router.post(
  '/:repoId/pulls/:number/suggestions/apply',
  requireRepoAccess(),
  pullsController.applySuggestion,
);
router.post(
  '/:repoId/pulls/:number/suggestions/batch-apply',
  requireRepoAccess(),
  pullsController.batchApplySuggestions,
);

export default router;
