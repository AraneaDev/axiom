import type { Request, Response, NextFunction } from 'express';

import { requestPathname } from '../lib/request-path';
import { metrics } from '../modules/health/health.metrics';

import { isBackendPath } from './static-frontend';

/**
 * Express middleware that records request metrics (method, path, status, duration)
 * into the in-memory MetricsCollector for the /api/health/metrics endpoint.
 * Served frontend requests (assets, client routes) are not recorded.
 * @param req
 * @param res
 * @param next
 */
export function metricsCollector(req: Request, res: Response, next: NextFunction): void {
  if (!isBackendPath(requestPathname(req))) return next();
  const start = Date.now();

  res.on('finish', () => {
    metrics.record({
      method: req.method,
      path: req.route?.path || req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
    });
  });

  next();
}
