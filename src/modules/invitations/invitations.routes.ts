import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as invitationsController from './invitations.controller';

const router = Router();

router.use(authenticate);

// Accept invitation (any authenticated user)
router.post('/invitations/:token/accept', invitationsController.accept);

export default router;
