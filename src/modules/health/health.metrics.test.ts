import { describe, it, expect, beforeEach } from 'vitest';

import { MetricsCollector } from './health.metrics';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  it('records request and increments counters', () => {
    metrics.record({ method: 'GET', path: '/api/issues', statusCode: 200, durationMs: 45 });
    metrics.record({ method: 'POST', path: '/api/issues', statusCode: 201, durationMs: 120 });

    const snapshot = metrics.snapshot();
    expect(snapshot.totalRequests).toBe(2);
    expect(snapshot.statusCodes['2xx']).toBe(2);
  });

  it('tracks status code distribution', () => {
    metrics.record({ method: 'GET', path: '/api/x', statusCode: 200, durationMs: 10 });
    metrics.record({ method: 'GET', path: '/api/x', statusCode: 404, durationMs: 5 });
    metrics.record({ method: 'POST', path: '/api/x', statusCode: 500, durationMs: 200 });

    const snapshot = metrics.snapshot();
    expect(snapshot.statusCodes['2xx']).toBe(1);
    expect(snapshot.statusCodes['4xx']).toBe(1);
    expect(snapshot.statusCodes['5xx']).toBe(1);
  });

  it('computes average duration', () => {
    metrics.record({ method: 'GET', path: '/a', statusCode: 200, durationMs: 100 });
    metrics.record({ method: 'GET', path: '/b', statusCode: 200, durationMs: 200 });

    const snapshot = metrics.snapshot();
    expect(snapshot.avgDurationMs).toBe(150);
  });

  it('resets counters', () => {
    metrics.record({ method: 'GET', path: '/a', statusCode: 200, durationMs: 10 });
    metrics.reset();

    const snapshot = metrics.snapshot();
    expect(snapshot.totalRequests).toBe(0);
  });
});
