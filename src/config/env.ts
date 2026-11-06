import './load-env';

import { z } from 'zod';

// An AES-256 key: base64 of exactly 32 bytes, as `openssl rand -base64 32` prints it.
// The messages name the variable but never repeat its value.
function encryptionKey(name: string) {
  return z
    .string({ error: `${name} is required. Generate with: openssl rand -base64 32` })
    .refine((value) => isBase64Key(value), {
      error: `${name} must be base64 of exactly 32 bytes. Generate with: openssl rand -base64 32`,
    });
}

function isBase64Key(value: string): boolean {
  const bytes = Buffer.from(value, 'base64');
  return bytes.length === 32 && bytes.toString('base64') === value;
}

const envSchema = z.object({
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  AXIOM_ENCRYPTION_KEY: encryptionKey('AXIOM_ENCRYPTION_KEY'),
  // Empty means unset: what rotation step 5 or a compose passthrough of an unset var leaves
  AXIOM_ENCRYPTION_KEY_PREVIOUS: z.preprocess(
    (value) => (value === '' ? undefined : value),
    encryptionKey('AXIOM_ENCRYPTION_KEY_PREVIOUS').optional(),
  ),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('*'),
  STATIC_DIR: z.string().optional(),
  // GitHub Enterprise Server or a test double would point these elsewhere. http: is for a local
  // double only; production refuses it below, since tokens travel on these
  GITHUB_API_URL: z.url({ protocol: /^https?$/ }).default('https://api.github.com'),
  GITHUB_WEB_URL: z.url({ protocol: /^https?$/ }).default('https://github.com'),
});

export const env = envSchema.parse(process.env);

// Block startup if production secrets look like placeholders. The dev compose and test
// encryption keys carry "Placeholder" in their text, so they land here too.
if (env.NODE_ENV === 'production') {
  const placeholderPattern = /change.me|dev.secret|placeholder|CHANGE_ME/i;
  const secrets = [
    ['JWT_SECRET', 'openssl rand -hex 32'],
    ['JWT_REFRESH_SECRET', 'openssl rand -hex 32'],
    ['AXIOM_ENCRYPTION_KEY', 'openssl rand -base64 32'],
    ['AXIOM_ENCRYPTION_KEY_PREVIOUS', 'openssl rand -base64 32'],
  ] as const;
  for (const [key, generate] of secrets) {
    const value = env[key];
    if (value !== undefined && placeholderPattern.test(value)) {
      throw new Error(
        `Refusing to start: ${key} contains a placeholder value. Generate with: ${generate}`,
      );
    }
  }
  for (const key of ['GITHUB_API_URL', 'GITHUB_WEB_URL'] as const) {
    if (new URL(env[key]).protocol !== 'https:') {
      throw new Error(`Refusing to start: ${key} must use https, tokens are sent to it`);
    }
  }
  // A key of one repeated byte (all zeros, say) is valid base64 of 32 bytes but no secret
  for (const key of ['AXIOM_ENCRYPTION_KEY', 'AXIOM_ENCRYPTION_KEY_PREVIOUS'] as const) {
    const value = env[key];
    if (value === undefined) continue;
    const bytes = Buffer.from(value, 'base64');
    if (bytes.every((byte) => byte === bytes[0])) {
      throw new Error(
        `Refusing to start: ${key} is one repeated byte. Generate with: openssl rand -base64 32`,
      );
    }
  }
}
