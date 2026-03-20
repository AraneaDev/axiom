import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireTeamPermission, requireRepoAccess } from '../../middleware/rbac';

import * as reposController from './repos.controller';

const router = Router();

router.use(authenticate);

// Team-scoped repo routes
router.post('/team/:teamId', requireTeamPermission('repo:create'), reposController.create);
router.get('/team/:teamId', requireTeamPermission('repo:read'), reposController.list);

// Repo-specific routes (require org membership via repo lookup)
router.get('/:repoId', requireRepoAccess(), reposController.get);
router.patch('/:repoId', requireRepoAccess(), reposController.update);
router.delete('/:repoId', requireRepoAccess(), reposController.remove);
router.post('/:repoId/fork', requireRepoAccess(), reposController.fork);
router.patch('/:repoId/settings', requireRepoAccess(), reposController.updateSettings);

// Branches
router.get('/:repoId/branches', requireRepoAccess(), reposController.listBranches);
router.post('/:repoId/branches', requireRepoAccess(), reposController.createBranch);
router.get('/:repoId/branches/:branchName', requireRepoAccess(), reposController.getBranch);
router.delete('/:repoId/branches/:branchName', requireRepoAccess(), reposController.deleteBranch);

// Commits
router.get('/:repoId/commits', requireRepoAccess(), reposController.listCommits);
router.get('/:repoId/commits/:sha', requireRepoAccess(), reposController.getCommit);

// File browser — root and subdirectory variants
router.get('/:repoId/tree/:ref', requireRepoAccess(), reposController.getTree);
router.get('/:repoId/tree/:ref/*', requireRepoAccess(), reposController.getTree);
router.get('/:repoId/blob/:ref/*', requireRepoAccess(), reposController.getBlob);
router.get('/:repoId/blame/:ref/*', requireRepoAccess(), reposController.getBlame);

// Tags
router.get('/:repoId/tags', requireRepoAccess(), reposController.listTags);

export default router;
