import fs from 'fs';
import os from 'os';
import path from 'path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The real limiters skip in NODE_ENV=test. Swap in a global limiter with the production
// limits and no skip, so this file checks where index.ts mounts it.
vi.mock('./middleware/rate-limit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./middleware/rate-limit.js')>();
  const { default: rateLimit } = await import('express-rate-limit');
  return {
    ...actual,
    globalLimiter: rateLimit({
      ...actual.GLOBAL_LIMIT,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  };
});

let dir: string;
let app: import('express').Express;
let metrics: typeof import('./modules/health/health.metrics').metrics;
const OVER_LIMIT = 301;

describe('global rate limit scope with the served frontend', () => {
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-static-rl-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html></html>');
    fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1);');
    process.env.STATIC_DIR = dir;
    app = (await import('./index')).default;
    ({ metrics } = await import('./modules/health/health.metrics'));
  });

  afterAll(() => {
    delete process.env.STATIC_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('static assets and client routes are never rate limited', async () => {
    const statuses = new Set<number>();
    for (let i = 0; i < OVER_LIMIT; i++) {
      const res = await request(app).get(i % 2 ? '/assets/app.js' : '/some/client/route');
      statuses.add(res.status);
    }
    expect([...statuses]).toEqual([200]);
  });

  it('static requests are not recorded in the request metrics', async () => {
    metrics.reset();
    await request(app).get('/assets/app.js');
    await request(app).get('/some/client/route');
    expect(metrics.snapshot().totalRequests).toBe(0);
    await request(app).get('/api/does-not-exist');
    expect(metrics.snapshot().totalRequests).toBe(1);
  });

  it('the API is still rate limited', async () => {
    let last = 0;
    for (let i = 0; i < OVER_LIMIT; i++) {
      last = (await request(app).get('/api/does-not-exist')).status;
    }
    expect(last).toBe(429);
  });
});
