import { Router } from 'express';
import * as pullsController from './pulls.controller';
import { authenticate } from '../../middleware/auth';

const router = Router();

router.use(authenticate);

// PR CRUD
router.post('/:repoId/pulls', pullsController.create);
router.get('/:repoId/pulls', pullsController.list);
router.get('/:repoId/pulls/:number', pullsController.get);
router.patch('/:repoId/pulls/:number', pullsController.update);
router.post('/:repoId/pulls/:number/close', pullsController.close);
router.post('/:repoId/pulls/:number/merge', pullsController.merge);

// PR diff and commits
router.get('/:repoId/pulls/:number/diff', pullsController.getDiff);
router.get('/:repoId/pulls/:number/commits', pullsController.getCommits);

// Linked issues
router.get('/:repoId/pulls/:number/issues', pullsController.getLinkedIssues);

// Reviews
router.post('/:repoId/pulls/:number/reviews', pullsController.submitReview);
router.get('/:repoId/pulls/:number/reviews', pullsController.listReviews);

// PR Comments (general + inline)
router.post('/:repoId/pulls/:number/comments', pullsController.addComment);
router.get('/:repoId/pulls/:number/comments', pullsController.listComments);

export default router;
