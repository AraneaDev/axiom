import { Router } from 'express';

import * as ctrl from './connect-rpc.controller';
import { authenticateRunner } from './runner-auth';

const router = Router();

// Ping -- no auth required
router.post('/actions/ping.v1.PingService/Ping', ctrl.ping);

// Register -- uses registration token in body, no runner auth
router.post('/actions/runner.v1.RunnerService/Register', ctrl.register);

// All other protocol endpoints require runner auth
router.post('/actions/runner.v1.RunnerService/Declare', authenticateRunner, ctrl.declare);

export default router;
