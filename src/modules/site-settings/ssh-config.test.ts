import request from 'supertest';
import { describe, it, expect } from 'vitest';

import app from '../../index';

import { getSshCloneConfig } from './ssh-config';

describe('getSshCloneConfig', () => {
  it('is disabled with defaults when nothing is set', () => {
    expect(getSshCloneConfig({})).toEqual({ enabled: false, host: null, port: 2222 });
  });

  it('prefers SSH_PUBLIC_PORT over SSH_PORT', () => {
    expect(
      getSshCloneConfig({
        SSH_ENABLED: 'true',
        SSH_PUBLIC_HOST: 'git.example.com',
        SSH_PUBLIC_PORT: '22',
        SSH_PORT: '2222',
      }),
    ).toEqual({ enabled: true, host: 'git.example.com', port: 22 });
  });

  it('falls back to SSH_PORT and ignores invalid ports', () => {
    expect(getSshCloneConfig({ SSH_PORT: '2200', SSH_PUBLIC_PORT: 'abc' }).port).toBe(2200);
    expect(getSshCloneConfig({ SSH_PORT: '70000' }).port).toBe(2222);
  });

  it('treats a blank host as unset', () => {
    expect(getSshCloneConfig({ SSH_PUBLIC_HOST: '  ' }).host).toBeNull();
  });
});

describe('GET /api/site-settings', () => {
  it('includes the ssh block', async () => {
    const res = await request(app).get('/api/site-settings');
    expect(res.status).toBe(200);
    expect(res.body.ssh).toEqual(
      expect.objectContaining({ enabled: expect.any(Boolean), port: expect.any(Number) }),
    );
  });
});
