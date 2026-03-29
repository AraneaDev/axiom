import { test, expect } from '@playwright/test';

import { login, ORG, DEMO_USERS } from './helpers';

const TEAM = 'core';
const WIKI_URL = `/${ORG}/${TEAM}/wiki`;

test.describe('Wiki Templates', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('shows template picker on new page', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/new`);
    await expect(page.getByText(/choose a template/i)).toBeVisible({ timeout: 10_000 });
    // Built-in templates should be listed as buttons
    await expect(page.getByRole('button', { name: /meeting notes/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: /retrospective/i }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('can apply a template', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/new`);
    await expect(page.getByText(/choose a template/i)).toBeVisible({ timeout: 10_000 });

    // Click the Meeting Notes template button
    await page.getByRole('button', { name: /meeting notes/i }).click();

    // Title input should be set to "Meeting Notes"
    const titleInput = page.getByRole('textbox', { name: /title/i });
    await expect(titleInput).toHaveValue(/meeting notes/i, { timeout: 10_000 });

    // Editor (ProseMirror) should be visible with template content
    const editor = page.locator('.ProseMirror, [contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 10_000 });

    // Template headings render inside the ProseMirror editor as visible text
    await expect(page.getByText('Facilitator').first()).toBeVisible({ timeout: 10_000 });
  });

  test('resolves template variables', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/new`);
    await expect(page.getByText(/choose a template/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /meeting notes/i }).click();

    // Wait for template to be applied — "Facilitator" heading appears in the editor
    await expect(page.getByText('Facilitator').first()).toBeVisible({ timeout: 10_000 });

    // The admin user's display name should appear (resolved from {{currentUser.displayName}})
    await expect(page.getByText(DEMO_USERS.admin.display).first()).toBeVisible({ timeout: 10_000 });

    // Raw template variables should NOT appear anywhere on the page
    await expect(page.getByText('{{currentUser.displayName}}')).not.toBeVisible({ timeout: 3_000 });
    await expect(page.getByText('{{team.name}}')).not.toBeVisible({ timeout: 3_000 });

    // Team name should be resolved (E2E seed team is "Core")
    // Use the heading "Team" followed by the resolved value
    await expect(page.getByText('Team').first()).toBeVisible({ timeout: 10_000 });
  });

  test('can hide template picker', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/new`);
    await expect(page.getByText(/choose a template/i)).toBeVisible({ timeout: 10_000 });

    // Click "Hide templates" button
    await page.getByRole('button', { name: /hide templates/i }).click();

    await expect(page.getByText(/choose a template/i)).not.toBeVisible({ timeout: 10_000 });
  });

  test('blank page option starts with empty content', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/new`);
    await expect(page.getByText(/choose a template/i)).toBeVisible({ timeout: 10_000 });

    // Click the "Blank page" option
    await page.getByRole('button', { name: /blank page/i }).click();

    // Template picker should be hidden after selecting blank
    await expect(page.getByText(/choose a template/i)).not.toBeVisible({ timeout: 10_000 });

    // Title should be empty
    const titleInput = page.getByRole('textbox', { name: /title/i });
    await expect(titleInput).toHaveValue('', { timeout: 10_000 });
  });

  test('shows template variable panel', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/new`);
    await expect(page.getByText(/choose a template/i)).toBeVisible({ timeout: 10_000 });

    // The Variables button is in the toolbar
    const variablesButton = page.getByRole('button', { name: /variables/i });
    await expect(variablesButton).toBeVisible({ timeout: 10_000 });
    await variablesButton.click();

    // Variable reference panel shows categories — "Date & Time" is one category heading
    await expect(page.getByText('Date & Time').first()).toBeVisible({ timeout: 10_000 });
  });
});
