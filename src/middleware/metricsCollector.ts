import type { Request, Response, NextFunction } from 'express';

import { metrics } from '../modules/health/health.metrics';

/**
 * Express middleware that records request metrics (method, path, status, duration)
 * into the in-memory MetricsCollector for the /api/health/metrics endpoint.
 * @param req
 * @param res
 * @param next
 */
export function metricsCollector(req: Request, res: Response, next: NextFunction): void {
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
