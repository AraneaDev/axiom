import { createRequire } from 'module';

import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    // Production runs the backend as CommonJS, where `yjs` is its CJS build, and the
    // editor core bundle requires that same build. Vitest would otherwise load the ESM
    // build for test files: a second copy of yjs whose types the bundle rejects.
    alias: [{ find: /^yjs$/, replacement: require.resolve('yjs') }],
  },
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./src/test/global-setup.ts', './src/test/editor-core-setup.ts'],
    env: {
      DATABASE_URL: 'postgresql://axiom:axiom_dev@localhost:5432/axiom_test?schema=public',
      JWT_SECRET: 'test-secret-must-be-at-least-32-characters-long',
      JWT_REFRESH_SECRET: 'test-refresh-secret-must-be-32-chars-long',
      // Marked dev key (base64 of 32 bytes); production refuses it as a placeholder
      AXIOM_ENCRYPTION_KEY: 'AxiomTestPlaceholderKeyForVitestRunsOnly000=',
      PORT: '3001',
      NODE_ENV: 'test',
      REDIS_URL: 'redis://:axiom_dev_redis@localhost:6379',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 40,
        statements: 50,
      },
    },
    testTimeout: 15000,
    sequence: { concurrent: false },
    fileParallelism: false,
    include: ['src/**/*.{test,spec}.ts'],
  },
});
