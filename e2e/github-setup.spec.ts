import { execFileSync } from 'node:child_process';

import { test, expect } from '@playwright/test';

import { DEMO_USERS, login } from './helpers';

// The seed runs inside the api container, so it uses that container's database and secret key.
// GitHub itself is not reached: the GitHub side of the flow is covered by the backend tests.
function seed(...args: string[]) {
  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      'docker-compose.dev.yml',
      'exec',
      '-T',
      'api',
      'npx',
      'tsx',
      'scripts/e2e-seed-github-app.ts',
      ...args,
    ],
    { stdio: 'pipe' },
  );
}

test.describe('GitHub setup', () => {
  test.beforeAll(() => seed());
  test.afterAll(() => seed('remove'));

  test('a user sees Connect GitHub when an App is set up', async ({ page }) => {
    await login(page, DEMO_USERS.admin);
    await page.goto('/settings/github');
    await expect(page.getByRole('button', { name: 'Connect GitHub' })).toBeVisible({
      timeout: 10_000,
    });
  });
});
