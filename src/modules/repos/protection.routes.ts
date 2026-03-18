import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as protectionController from './protection.controller';

const router = Router();

router.use(authenticate);

router.post('/:repoId/branch-protection', protectionController.create);
router.get('/:repoId/branch-protection', protectionController.list);
router.get('/:repoId/branch-protection/:ruleId', protectionController.get);
router.patch('/:repoId/branch-protection/:ruleId', protectionController.update);
router.delete('/:repoId/branch-protection/:ruleId', protectionController.remove);

export default router;
