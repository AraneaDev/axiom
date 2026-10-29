import { test, expect } from '@playwright/test';

import { login, ORG } from './helpers';

const TEAM = 'core';
const WIKI_URL = `/${ORG}/${TEAM}/wiki`;

test.describe('Wiki Editing', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to wiki and see spaces', async ({ page }) => {
    await page.goto(WIKI_URL);
    await expect(page.getByRole('heading', { name: /wiki/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('main').getByRole('heading', { name: 'Docs' })).toBeVisible();
  });

  test('edit button navigates to editor', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/getting-started`);
    const editLink = page.getByRole('link', { name: /edit/i });
    await expect(editLink).toBeVisible({ timeout: 10_000 });
    await editLink.click();
    await expect(page).toHaveURL(/\/edit$/);
    // TipTap editor should load
    await expect(
      page.locator('.tiptap-editor, .ProseMirror, [contenteditable="true"]').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('editor has save button', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/getting-started/edit`);
    await expect(
      page.locator('.tiptap-editor, .ProseMirror, [contenteditable="true"]').first()
    ).toBeVisible({ timeout: 10_000 });
    // Should show a save/publish button
    await expect(
      page.getByRole('button', { name: /save|publish|update/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('editor allows typing content', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/getting-started/edit`);
    const editor = page.locator('.ProseMirror, [contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 10_000 });
    // Type into the editor
    await editor.click();
    await page.keyboard.type('E2E test content');
    // Verify text was entered
    await expect(editor).toContainText('E2E test content');
  });

  test('create new wiki page button exists', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs`);
    // Look for a create/new page button
    await expect(page.getByRole('link', { name: 'New Page' }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('wiki page view renders markdown content', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/handbook`);
    // The page should render markdown with prose styling
    await expect(
      page.locator('.prose').first()
    ).toBeVisible({ timeout: 10_000 });
    // Should contain heading elements from the markdown
    await expect(
      page.locator('.prose h1, .prose h2, .prose h3, .prose p').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('editor toolbar is visible', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/getting-started/edit`);
    await expect(
      page.locator('.ProseMirror, [contenteditable="true"]').first()
    ).toBeVisible({ timeout: 10_000 });
    // Editor toolbar should have formatting buttons (bold, italic, etc.)
    await expect(page.getByRole('button', { name: 'Bold' })).toBeVisible({ timeout: 10_000 });
  });
});
