import { Router } from 'express';
import * as reposController from './repos.controller';
import { authenticate } from '../../middleware/auth';
import { requireTeamPermission } from '../../middleware/rbac';

const router = Router();

router.use(authenticate);

// Team-scoped repo routes
router.post('/team/:teamId', requireTeamPermission('repo:create'), reposController.create);
router.get('/team/:teamId', reposController.list);

// Repo-specific routes
router.get('/:repoId', reposController.get);
router.patch('/:repoId', reposController.update);
router.delete('/:repoId', reposController.remove);
router.post('/:repoId/fork', reposController.fork);

// Branches
router.get('/:repoId/branches', reposController.listBranches);
router.post('/:repoId/branches', reposController.createBranch);
router.get('/:repoId/branches/:branchName', reposController.getBranch);
router.delete('/:repoId/branches/:branchName', reposController.deleteBranch);

// Commits
router.get('/:repoId/commits', reposController.listCommits);
router.get('/:repoId/commits/:sha', reposController.getCommit);

// File browser — root and subdirectory variants
router.get('/:repoId/tree/:ref', reposController.getTree);
router.get('/:repoId/tree/:ref/*', reposController.getTree);
router.get('/:repoId/blob/:ref/*', reposController.getBlob);
router.get('/:repoId/blame/:ref/*', reposController.getBlame);

// Tags
router.get('/:repoId/tags', reposController.listTags);

export default router;
