import { z } from 'zod';

import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';

import { metrics } from './health.metrics';
import * as healthService from './health.service';

/**
 * The health check and the request counters. Both are open to anyone, as the container check and
 * the load balancer call them with no credential; the handlers read no user (ctx.userId is
 * undefined) and neither is open to a token.
 */
const noTarget = z.object({});
const nothing = z.void();

registerActions([
  defineAction({
    name: 'health.check',
    uiOnly: true,
    area: 'issues',
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
    area: 'issues',
    kind: 'read',
    summary: 'Read the request counters since the server started',
    input: noTarget,
    output: z.looseObject({ totalRequests: z.number() }),
    rest: { method: 'GET', path: '/api/health/metrics', public: true },
    authorize: async () => {},
    handler: async () => ({ ...metrics.snapshot() }),
  }),
]);
