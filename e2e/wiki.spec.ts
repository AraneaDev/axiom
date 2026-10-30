import { readFileSync } from 'node:fs';

import { test, expect } from '@playwright/test';

import { login, ORG } from './helpers';

const WIKI_URL = `/${ORG}/core/wiki`;

test.describe('Wiki', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('wiki home lists spaces', async ({ page }) => {
    await page.goto(WIKI_URL);
    await expect(page.getByRole('heading', { name: /wiki/i })).toBeVisible();
    // Seed has "Docs" space for Core team
    await expect(page.getByRole('main').getByRole('heading', { name: 'Docs' })).toBeVisible();
  });

  test('wiki page renders markdown', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/handbook`);
    // Page should have rendered markdown content (headings, lists)
    await expect(page.locator('.prose h2', { hasText: 'Working agreements' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('.prose li', { hasText: 'Review before merge' })).toBeVisible();
  });

  test('wiki page with mermaid diagram renders', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/architecture`);
    // Mermaid diagrams render as SVG
    await expect(page.locator('svg[id^="mermaid-"]')).toBeVisible({ timeout: 15_000 });
  });

  test('wiki page edit button navigates to editor', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/getting-started`);
    await page.getByRole('link', { name: /edit/i }).click();
    await expect(page).toHaveURL(`${WIKI_URL}/docs/getting-started/edit`);
    // TipTap editor should be present
    await expect(page.locator('.tiptap-editor, .ProseMirror')).toBeVisible({ timeout: 10_000 });
  });

  test('export as Markdown downloads the real page content', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/handbook`);
    await page.getByRole('button', { name: /export/i }).click();
    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
    await page.getByRole('menuitem', { name: 'Markdown' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('handbook.md');

    const path = await download.path();
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('# Team handbook');
    expect(content).toContain('## Working agreements');
    expect(content).toContain('- Review before merge');
    expect(content).not.toContain('<paragraph');
  });
});
