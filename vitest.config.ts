import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./src/test/global-setup.ts'],
    env: {
      DATABASE_URL: 'postgresql://axiom:axiom_dev@localhost:5432/axiom_test?schema=public',
      JWT_SECRET: 'test-secret-must-be-at-least-32-characters-long',
      JWT_REFRESH_SECRET: 'test-refresh-secret-must-be-32-chars-long',
      PORT: '3001',
      REPOS_PATH: '/tmp/axiom-test-repos',
      NODE_ENV: 'test',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    },
    testTimeout: 15000,
    sequence: { concurrent: false },
    fileParallelism: false,
    include: ['src/**/*.{test,spec}.ts'],
  },
});
