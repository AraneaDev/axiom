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
    // Built-in templates should be listed
    await expect(
      page.getByText(/meeting notes/i).first()
        .or(page.getByText(/retrospective/i).first())
    ).toBeVisible({ timeout: 10_000 });
  });

  test('can apply a template', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/new`);
    await expect(page.getByText(/choose a template/i)).toBeVisible({ timeout: 10_000 });

    // Click the Meeting Notes template
    await page.getByText(/meeting notes/i).first().click();

    // Title should be set to "Meeting Notes"
    const titleInput = page
      .getByRole('textbox', { name: /title/i })
      .first()
      .or(page.locator('input[placeholder*="title" i], [data-testid="page-title"]').first());
    await expect(titleInput).toHaveValue(/meeting notes/i, { timeout: 10_000 });

    // Body should contain template headings
    const editor = page.locator('.ProseMirror, .tiptap-editor, [contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/facilitator/i).first()
        .or(page.getByText(/attendees/i).first())
    ).toBeVisible({ timeout: 10_000 });
  });

  test('resolves template variables', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/new`);
    await expect(page.getByText(/choose a template/i)).toBeVisible({ timeout: 10_000 });

    await page.getByText(/meeting notes/i).first().click();

    const editor = page.locator('.ProseMirror, .tiptap-editor, [contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 10_000 });

    // Template variables should be resolved — raw placeholder should not appear
    const rawVariable = page.getByText('{{currentUser.displayName}}');
    await expect(rawVariable).not.toBeVisible({ timeout: 5_000 });

    // The logged-in user's display name should appear instead
    await expect(
      page.getByText(new RegExp(DEMO_USERS.admin.display, 'i')).first()
        .or(page.getByText(/admin/i).first())
    ).toBeVisible({ timeout: 10_000 });
  });

  test('can hide template picker', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/new`);
    await expect(page.getByText(/choose a template/i)).toBeVisible({ timeout: 10_000 });

    // Click "Hide templates" button
    await page.getByRole('button', { name: /hide templates/i }).click();

    await expect(page.getByText(/choose a template/i)).not.toBeVisible({ timeout: 10_000 });
  });

  test('blank page option clears content', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/new`);
    await expect(page.getByText(/choose a template/i)).toBeVisible({ timeout: 10_000 });

    // Apply a template first so there is content to clear
    await page.getByText(/meeting notes/i).first().click();
    const editor = page.locator('.ProseMirror, .tiptap-editor, [contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 10_000 });

    // Now select the blank page option
    const blankOption = page
      .getByRole('button', { name: /blank page/i })
      .first()
      .or(page.getByText(/blank page/i).first());
    await blankOption.click();

    // Title and body should be cleared
    const titleInput = page
      .getByRole('textbox', { name: /title/i })
      .first()
      .or(page.locator('input[placeholder*="title" i], [data-testid="page-title"]').first());
    await expect(titleInput).toHaveValue('', { timeout: 10_000 });

    // Editor content should be empty (ProseMirror renders an empty <p> with no text)
    await expect(page.getByText(/facilitator/i).first()).not.toBeVisible({ timeout: 5_000 });
  });

  test('shows template variable panel', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/new`);

    // Dismiss template picker or apply blank template to reach editor
    const hideButton = page.getByRole('button', { name: /hide templates/i });
    if (await hideButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await hideButton.click();
    }

    // Click the Variables button in the toolbar
    const variablesButton = page
      .getByRole('button', { name: /variables/i })
      .first()
      .or(page.locator('[data-testid="variables-panel"], [title*="variable" i]').first());
    await variablesButton.click();

    // Variable reference panel should appear with category headings
    await expect(
      page.getByText(/user/i).first()
        .or(page.getByText(/date/i).first())
        .or(page.getByText(/team/i).first())
    ).toBeVisible({ timeout: 10_000 });
  });
});
