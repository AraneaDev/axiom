import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';

import { redis } from '../../config/redis';

import * as ctrl from './connect-rpc.controller';
import { authenticateRunner } from './runner-auth';

const router = Router();

// Ping -- no auth required
router.post('/actions/ping.v1.PingService/Ping', ctrl.ping);

// Register -- uses registration token in body, no runner auth
router.post('/actions/runner.v1.RunnerService/Register', ctrl.register);

// All other protocol endpoints require runner auth
router.post('/actions/runner.v1.RunnerService/Declare', authenticateRunner, ctrl.declare);
router.post(
  '/actions/runner.v1.RunnerService/FetchTask',
  authenticateRunner,
  rateLimitRunner,
  ctrl.fetchTask,
);

router.post('/actions/runner.v1.RunnerService/UpdateTask', authenticateRunner, ctrl.updateTask);
router.post('/actions/runner.v1.RunnerService/UpdateLog', authenticateRunner, ctrl.updateLog);

export default router;

async function rateLimitRunner(req: Request, res: Response, next: NextFunction) {
  const uuid = req.headers['x-runner-uuid'] as string;
  if (!uuid) return next();
  try {
    const result = await redis.set(`runner:rate:${uuid}`, '1', 'EX', 1, 'NX');
    if (result === null) {
      res.status(429).json({ error: { message: 'Too many requests' } });
      return;
    }
  } catch {
    // Redis unavailable -- skip rate limiting
  }
  next();
}
