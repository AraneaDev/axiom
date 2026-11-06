import { randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

const PRODUCTION_SECRETS = {
  JWT_SECRET: randomBytes(32).toString('hex'),
  JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
};

describe('env', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    vi.resetModules();
    vi.doUnmock('./load-env');
  });

  async function loadEnv(overrides: Record<string, string | undefined>) {
    vi.resetModules();
    vi.doMock('./load-env', () => ({}));
    process.env = { ...original };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return import('./env');
  }

  it('env parses without HOOK_SECRET or REPOS_PATH', async () => {
    const { env } = await loadEnv({ HOOK_SECRET: undefined, REPOS_PATH: undefined });

    expect(env.JWT_SECRET).toBeDefined();
    expect(env).not.toHaveProperty('HOOK_SECRET');
    expect(env).not.toHaveProperty('REPOS_PATH');
  });

  it('accepts a 32-byte base64 key and an optional previous key', async () => {
    const current = randomBytes(32).toString('base64');
    const previous = randomBytes(32).toString('base64');
    const { env } = await loadEnv({
      ...PRODUCTION_SECRETS,
      NODE_ENV: 'production',
      AXIOM_ENCRYPTION_KEY: current,
      AXIOM_ENCRYPTION_KEY_PREVIOUS: previous,
    });

    expect(env.AXIOM_ENCRYPTION_KEY).toBe(current);
    expect(env.AXIOM_ENCRYPTION_KEY_PREVIOUS).toBe(previous);
  });

  it('refuses startup without an encryption key', async () => {
    await expect(loadEnv({ AXIOM_ENCRYPTION_KEY: undefined })).rejects.toThrow(
      /AXIOM_ENCRYPTION_KEY/,
    );
  });

  it('refuses startup with a 31-byte key', async () => {
    const short = randomBytes(31).toString('base64');
    await expect(loadEnv({ AXIOM_ENCRYPTION_KEY: short })).rejects.toThrow(/AXIOM_ENCRYPTION_KEY/);
  });

  it('refuses startup with a key that is not base64', async () => {
    const notBase64 = 'not base64 at all, but long enough to be 44 c';
    await expect(loadEnv({ AXIOM_ENCRYPTION_KEY: notBase64 })).rejects.toThrow(
      /AXIOM_ENCRYPTION_KEY/,
    );
  });

  it('refuses startup with a bad previous key', async () => {
    const short = randomBytes(31).toString('base64');
    await expect(loadEnv({ AXIOM_ENCRYPTION_KEY_PREVIOUS: short })).rejects.toThrow(
      /AXIOM_ENCRYPTION_KEY_PREVIOUS/,
    );
  });

  it('the startup error never repeats the key', async () => {
    const short = randomBytes(31).toString('base64');
    const error = await loadEnv({ AXIOM_ENCRYPTION_KEY: short }).then(
      () => null,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('AXIOM_ENCRYPTION_KEY');
    expect((error as Error).message).not.toContain(short);
  });

  it('refuses a marked dev key in production', async () => {
    await expect(
      loadEnv({
        ...PRODUCTION_SECRETS,
        NODE_ENV: 'production',
        AXIOM_ENCRYPTION_KEY: 'AxiomDevPlaceholderKeyForLocalDevelopment00=',
      }),
    ).rejects.toThrow(/Refusing to start: AXIOM_ENCRYPTION_KEY contains a placeholder value/);
  });

  it('refuses a marked dev previous key in production', async () => {
    await expect(
      loadEnv({
        ...PRODUCTION_SECRETS,
        NODE_ENV: 'production',
        AXIOM_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
        AXIOM_ENCRYPTION_KEY_PREVIOUS: 'AxiomDevPlaceholderKeyForLocalDevelopment00=',
      }),
    ).rejects.toThrow(/AXIOM_ENCRYPTION_KEY_PREVIOUS contains a placeholder value/);
  });

  it('accepts the marked dev key outside production', async () => {
    const { env } = await loadEnv({
      NODE_ENV: 'development',
      AXIOM_ENCRYPTION_KEY: 'AxiomDevPlaceholderKeyForLocalDevelopment00=',
    });

    expect(env.AXIOM_ENCRYPTION_KEY).toBe('AxiomDevPlaceholderKeyForLocalDevelopment00=');
  });
});
