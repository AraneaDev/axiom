import { describe, it, expect } from 'vitest';

import { buildSafeEnv } from './pipeline-env';

describe('buildSafeEnv', () => {
  it('includes only allowlisted system vars', () => {
    const env = buildSafeEnv(
      { PATH: '/usr/bin', HOME: '/root', DATABASE_URL: 'postgres://secret', JWT_SECRET: 'abc' },
      { AXIOM_BRANCH: 'main' },
      { MY_VAR: 'hello' },
    );
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/root');
    expect(env.AXIOM_BRANCH).toBe('main');
    expect(env.MY_VAR).toBe('hello');
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.JWT_SECRET).toBeUndefined();
  });

  it('does not leak REDIS_URL, SESSION_SECRET, or HOOK_SECRET', () => {
    const env = buildSafeEnv(
      { REDIS_URL: 'redis://x', SESSION_SECRET: 'x', HOOK_SECRET: 'x', LANG: 'en_US.UTF-8' },
      {},
      {},
    );
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.SESSION_SECRET).toBeUndefined();
    expect(env.HOOK_SECRET).toBeUndefined();
    expect(env.LANG).toBe('en_US.UTF-8');
  });

  it('step env overrides context env', () => {
    const env = buildSafeEnv({}, { FOO: 'ctx' }, { FOO: 'step' });
    expect(env.FOO).toBe('step');
  });
});
