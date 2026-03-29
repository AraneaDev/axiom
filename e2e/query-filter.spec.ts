import { test, expect } from '@playwright/test';

import { login, ORG } from './helpers';

const TEAM = 'core';
const PROJECT = 'platform';
const ISSUES_URL = `/${ORG}/${TEAM}/${PROJECT}/issues`;

// Helper: count issue rows in the main issue list (not sidebar links)
function issueRows(page: import('@playwright/test').Page) {
  return page.locator('main a[href*="/issues/"]');
}

test.describe('Query Filter', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('shows all 7 seeded issues without filters', async ({ page }) => {
    await page.goto(ISSUES_URL);
    await expect(page.getByRole('heading', { name: /issues/i, level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    // Seed creates 7 issues
    await expect(page.getByText(/showing 1-7 of 7/i)).toBeVisible({ timeout: 10_000 });
  });

  test('filters issues by type via q param', async ({ page }) => {
    await page.goto(`${ISSUES_URL}?q=type:bug`);
    await expect(page.getByRole('heading', { name: /issues/i, level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // Should show exactly 2 BUG issues
    await expect(page.getByText(/showing 1-2 of 2/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Login page shows blank on slow connection')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Fix broken search indexing')).toBeVisible({ timeout: 10_000 });
    // Non-BUG issues should NOT be visible
    await expect(page.getByText('Set up CI/CD pipeline')).not.toBeVisible({ timeout: 3_000 });
  });

  test('filters issues by priority via q param', async ({ page }) => {
    await page.goto(`${ISSUES_URL}?q=priority:high`);
    await expect(page.getByRole('heading', { name: /issues/i, level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // Should show exactly 2 HIGH priority issues
    await expect(page.getByText(/showing 1-2 of 2/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Set up CI/CD pipeline')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Fix broken search indexing')).toBeVisible({ timeout: 10_000 });
  });

  test('filters with compound query via q param', async ({ page }) => {
    await page.goto(`${ISSUES_URL}?q=type:bug+priority:critical`);
    await expect(page.getByRole('heading', { name: /issues/i, level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // Should show exactly 1 issue: the CRITICAL BUG
    await expect(page.getByText(/showing 1-1 of 1/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Login page shows blank on slow connection')).toBeVisible({ timeout: 10_000 });
  });

  test('plain text q falls back to title search', async ({ page }) => {
    await page.goto(`${ISSUES_URL}?q=CI`);
    await expect(page.getByRole('heading', { name: /issues/i, level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // Should match only the CI/CD pipeline issue via title text search
    await expect(page.getByText(/showing 1-1 of 1/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Set up CI/CD pipeline')).toBeVisible({ timeout: 10_000 });
  });

  test('query engine filters correctly via API', async ({ request }) => {
    // Login via API to get JWT token
    const loginRes = await request.post('/api/auth/login', {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      data: { login: 'admin', password: 'password123' },
    });
    const { accessToken } = await loginRes.json();
    const h = { 'X-Requested-With': 'XMLHttpRequest', 'Authorization': `Bearer ${accessToken}` };

    const orgs = await (await request.get('/api/orgs', { headers: h })).json();
    const teams = await (await request.get(`/api/teams/org/${orgs[0].id}`, { headers: h })).json();
    const projects = await (await request.get(`/api/projects/team/${teams.data[0].id}`, { headers: h })).json();
    const pid = projects[0].id;

    // type:bug should return 2
    const bugs = await (await request.get(`/api/projects/${pid}/issues?q=type:bug`, { headers: h })).json();
    expect(bugs.total).toBe(2);
    expect(bugs.issues.every((i: any) => i.type === 'BUG')).toBe(true);

    // Compound: type:bug priority:critical should return 1
    const critBugs = await (await request.get(`/api/projects/${pid}/issues?q=type:bug+priority:critical`, { headers: h })).json();
    expect(critBugs.total).toBe(1);
    expect(critBugs.issues[0].type).toBe('BUG');
    expect(critBugs.issues[0].priority).toBe('CRITICAL');
  });
});
