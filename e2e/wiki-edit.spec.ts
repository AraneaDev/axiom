import { test, expect } from '@playwright/test';

import { login, ORG, wikiApi } from './helpers';

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
  test('a page with a heading, list, table and code renders as structure in the editor', async ({
    page,
    request,
  }) => {
    const api = await wikiApi(request);
    const slug = `structure-${Date.now()}`;
    await api.createPage(
      slug,
      'Structure',
      [
        '# Structure heading',
        '',
        '- first item',
        '- second item',
        '',
        '| Name | Value |',
        '| --- | --- |',
        '| alpha | 1 |',
        '',
        '```ts',
        'const answer = 42;',
        '```',
        '',
      ].join('\n'),
    );

    await page.goto(`${WIKI_URL}/docs/${slug}/edit`);
    const editor = page.locator('.ProseMirror').first();
    await expect(editor.locator('h1')).toHaveText('Structure heading', { timeout: 15_000 });
    await expect(editor.locator('ul li')).toHaveCount(2);
    await expect(editor.locator('table')).toBeVisible();
    await expect(editor.locator('table td, table th').first()).toBeVisible();
    await expect(editor.locator('pre code')).toContainText('const answer = 42;');
    // Rendered as structure, not as Markdown source
    await expect(editor).not.toContainText('# ');
    await expect(editor).not.toContainText('```');
    await expect(editor).not.toContainText('| ---');
  });

  test('autosave stores Markdown, never editor XML', async ({ page, request }) => {
    const api = await wikiApi(request);
    const slug = `autosave-${Date.now()}`;
    await api.createPage(slug, 'Autosave', '# Autosave\n\nStart.\n');

    await page.goto(`${WIKI_URL}/docs/${slug}/edit`);
    const editor = page.locator('.ProseMirror').first();
    await expect(editor.locator('h1')).toHaveText('Autosave', { timeout: 15_000 });
    await editor.getByText('Start.').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' typed by the e2e autosave test');

    // The collaboration server saves a few seconds after the last edit
    await expect
      .poll(async () => (await api.getPage(slug)).body, { timeout: 15_000, intervals: [1000] })
      .toContain('typed by the e2e autosave test');
    const { body } = await api.getPage(slug);
    expect(body).toContain('# Autosave');
    expect(body).not.toContain('<paragraph');
  });
});
