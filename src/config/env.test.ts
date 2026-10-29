import { afterEach, describe, expect, it, vi } from 'vitest';

describe('env', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    vi.resetModules();
    vi.doUnmock('./load-env');
  });

  it('env parses without HOOK_SECRET or REPOS_PATH', async () => {
    vi.resetModules();
    vi.doMock('./load-env', () => ({}));
    process.env = { ...original };
    delete process.env.HOOK_SECRET;
    delete process.env.REPOS_PATH;

    const { env } = await import('./env');

    expect(env.JWT_SECRET).toBeDefined();
    expect(env).not.toHaveProperty('HOOK_SECRET');
    expect(env).not.toHaveProperty('REPOS_PATH');
  });
});
