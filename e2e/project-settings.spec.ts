import { test, expect } from '@playwright/test';

import { DEMO_USERS, login, ORG } from './helpers';

const TEAM = 'axiom';
const PROJECT = 'axiom-mvp';
const SETTINGS_BASE = `/${ORG}/${TEAM}/${PROJECT}/settings`;

test.describe('Project Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USERS.admin);
  });

  test('navigate to project settings shows sidebar nav', async ({ page }) => {
    // /settings redirects to /settings/labels
    await page.goto(SETTINGS_BASE);
    await expect(page).toHaveURL(new RegExp(`${SETTINGS_BASE}/labels`), { timeout: 10_000 });

    // Sidebar heading
    await expect(page.getByText('Project Settings').first()).toBeVisible({ timeout: 10_000 });

    // All five nav items should be visible
    await expect(page.getByRole('link', { name: /labels/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /custom fields/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /templates/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /automations/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /workflows/i })).toBeVisible();
  });

  test('labels settings page loads with seed labels', async ({ page }) => {
    await page.goto(`${SETTINGS_BASE}/labels`);
    await expect(page.getByRole('heading', { name: /labels/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Seed data creates labels: bug, frontend, backend, enhancement
    await expect(page.getByText('bug').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('frontend').first()).toBeVisible();
    await expect(page.getByText('backend').first()).toBeVisible();

    // New Label button must be present
    await expect(page.getByRole('button', { name: /new label/i })).toBeVisible();
  });

  test('custom fields settings page loads', async ({ page }) => {
    await page.goto(`${SETTINGS_BASE}/fields`);
    await expect(page.getByRole('heading', { name: /custom fields/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Should show an "Add" or "New" button for creating fields
    await expect(
      page.getByRole('button', { name: /add|new|create/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('workflow settings page loads with statuses', async ({ page }) => {
    await page.goto(`${SETTINGS_BASE}/workflow`);
    // Heading
    await expect(
      page.getByRole('heading', { name: /workflow/i }).first().or(
        page.getByText(/workflow/i).first(),
      ),
    ).toBeVisible({ timeout: 10_000 });

    // Seed data includes standard statuses like "To Do", "In Progress", "Done"
    await expect(
      page.getByText(/to do|backlog|in progress|done/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('automations settings page loads', async ({ page }) => {
    await page.goto(`${SETTINGS_BASE}/automation`);
    await expect(
      page.getByRole('heading', { name: /automation/i }).first().or(
        page.getByText(/automation/i).first(),
      ),
    ).toBeVisible({ timeout: 10_000 });

    // Should show a button to create a rule
    await expect(
      page.getByRole('button', { name: /new rule|create rule|add rule/i }).first().or(
        page.getByRole('button', { name: /new|create|add/i }).first(),
      ),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('templates settings page loads', async ({ page }) => {
    await page.goto(`${SETTINGS_BASE}/templates`);
    await expect(
      page.getByRole('heading', { name: /template/i }).first().or(
        page.getByText(/template/i).first(),
      ),
    ).toBeVisible({ timeout: 10_000 });

    // Should show a button to create a template
    await expect(
      page.getByRole('button', { name: /new template|create template|add template/i })
        .first()
        .or(page.getByRole('button', { name: /new|create|add/i }).first()),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('can create and then cancel a new label', async ({ page }) => {
    await page.goto(`${SETTINGS_BASE}/labels`);
    await expect(page.getByRole('heading', { name: /labels/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Open create form
    await page.getByRole('button', { name: /new label/i }).click();
    await expect(page.getByLabel('Name')).toBeVisible({ timeout: 5_000 });

    // Cancel
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByLabel('Name')).not.toBeVisible({ timeout: 5_000 });
  });
});
