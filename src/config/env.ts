import './load-env';

import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  HOOK_SECRET: z.string().min(16),
  PORT: z.coerce.number().default(3000),
  REPOS_PATH: z.string().default('/data/repos'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('*'),
});

export const env = envSchema.parse(process.env);

// Block startup if production secrets look like placeholders
if (env.NODE_ENV === 'production') {
  const placeholderPattern = /change.me|dev.secret|placeholder|CHANGE_ME/i;
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'HOOK_SECRET'] as const) {
    if (placeholderPattern.test(env[key])) {
      throw new Error(
        `Refusing to start: ${key} contains a placeholder value. Generate with: openssl rand -hex 32`,
      );
    }
  }
}
