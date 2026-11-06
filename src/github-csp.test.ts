import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

let app: import('express').Express;

// The manifest flow posts a form to GitHub's web host, which a CSP of form-action 'self' blocks
describe('Content-Security-Policy form-action', () => {
  beforeAll(async () => {
    // env is parsed on import, so this must be set before anything pulls in the app
    process.env.GITHUB_WEB_URL = 'https://ghe.acme.test/';
    app = (await import('./index')).default;
  });

  it('allows self and the configured GitHub web origin, and nothing else', async () => {
    const res = await request(app).get('/api/health');
    const csp = String(res.headers['content-security-policy']);
    const formAction = csp.split(';').find((d) => d.trim().startsWith('form-action'));
    expect(formAction?.trim().split(/\s+/)).toEqual([
      'form-action',
      "'self'",
      'https://ghe.acme.test',
    ]);
  });
});
