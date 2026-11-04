import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireProjectAccess, requireProjectWrite } from '../../middleware/requireProjectAccess';

import * as boardColumnsCtrl from './board-columns.controller';
import * as issuesController from './issues.controller';

// Issues, comments, worklogs, links, votes, watchers and web links run through the action
// registry (issues.actions.ts), which is mounted ahead of this router. What is left here is
// the board and its settings, and the roadmap.
const router = Router();

router.use(authenticate);
// Writes follow the permission matrix: VIEWERs and GUESTs can read, not change
router.use('/:projectId', requireProjectWrite());
// Project settings: team ADMINs, org OWNERs/ADMINs and platform admins only
router.use('/:projectId/board/columns', requireProjectWrite('team:manage_members'));

router.use('/:projectId/board', requireProjectAccess);

router.get('/:projectId/board', issuesController.board);

// Board column management
router.post('/:projectId/board/columns', boardColumnsCtrl.create);
router.patch('/:projectId/board/columns/reorder', boardColumnsCtrl.reorder);
router.patch('/:projectId/board/columns/:columnId', boardColumnsCtrl.update);
router.delete('/:projectId/board/columns/:columnId', boardColumnsCtrl.remove);

// Roadmap
router.use('/:projectId/roadmap', requireProjectAccess);
router.get('/:projectId/roadmap', issuesController.roadmap);

export default router;
