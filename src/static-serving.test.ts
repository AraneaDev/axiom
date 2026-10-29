import fs from 'fs';
import os from 'os';
import path from 'path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const INDEX_HTML = '<!doctype html><html><body><div id="root">axiom-spa</div></body></html>';
let dir: string;
let app: import('express').Express;
let createTestUser: typeof import('./test/factory').createTestUser;

describe('static frontend serving', () => {
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-static-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'index.html'), INDEX_HTML);
    fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1);');
    process.env.STATIC_DIR = dir;
    // env is parsed on import, so STATIC_DIR must be set before anything pulls in the app.
    app = (await import('./index')).default;
    ({ createTestUser } = await import('./test/factory'));
  });

  afterAll(() => {
    delete process.env.STATIC_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('serves index.html for an unknown client route', async () => {
    const res = await request(app).get('/aranea-dev/axiom/issues/1');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toBe(INDEX_HTML);
  });

  it('serves hashed assets with immutable caching', async () => {
    const res = await request(app).get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('index.html is not cached', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-cache');
    const deep = await request(app).get('/some/deep/link');
    expect(deep.headers['cache-control']).toContain('no-cache');
  });

  it('unknown api route still returns JSON 404', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .get('/api/does-not-exist')
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toHaveProperty('error');
  });

  it('unauthenticated unknown api route is JSON, never index.html', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.text).not.toContain('axiom-spa');
  });

  it('index.html CSP allows blob and external images and blob frames', async () => {
    const res = await request(app).get('/');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("img-src 'self' data: blob: https:");
    expect(csp).toContain("frame-src 'self' blob:");
    expect(csp).toContain("media-src 'self' blob:");
    expect(csp).toContain("script-src 'self'");
  });

  it('api routes are unaffected', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('does not serve index.html for a missing asset', async () => {
    const res = await request(app).get('/assets/missing.js');
    expect(res.status).toBe(404);
  });
});
