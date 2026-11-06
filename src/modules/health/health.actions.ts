import { z } from 'zod';

import { platformAdmin } from '../../actions/authorize';
import { defineAction, definePublicAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';

import { metrics } from './health.metrics';
import * as healthService from './health.service';

/**
 * The health check is open to anyone, as the container check and the load balancer call it with no
 * credential; its handler reads no user (ctx.userId is undefined). The request counters are for a
 * platform admin. Neither is open to a token.
 */
const noTarget = z.object({});
const nothing = z.void();

registerActions([
  definePublicAction({
    name: 'health.check',
    uiOnly: true,
    area: 'admin',
    kind: 'read',
    summary: 'Check the database and Redis, for the container check and the admin dashboard',
    input: noTarget,
    output: nothing,
    // Raw: an unhealthy installation answers 503 with the same body
    rest: { method: 'GET', path: '/api/health', raw: true, public: true },
    authorize: async () => {},
    handler: async (ctx) => {
      if (!ctx.http) throw new AppError(500, 'The health check needs the response');
      const report = await healthService.checkHealth();
      ctx.http.res.status(report.status === 'unhealthy' ? 503 : 200).json(report);
    },
  }),
  defineAction({
    name: 'health.metrics',
    uiOnly: true,
    admin: true,
    area: 'admin',
    kind: 'read',
    summary: 'Read the request counters since the server started (platform admins)',
    input: noTarget,
    output: z.looseObject({ totalRequests: z.number() }),
    rest: { method: 'GET', path: '/api/health/metrics' },
    authorize: platformAdmin,
    handler: async () => ({ ...metrics.snapshot() }),
  }),
]);
