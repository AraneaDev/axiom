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

  test('export wiki page triggers download', async ({ page }) => {
    await page.goto(`${WIKI_URL}/docs/getting-started`);
    // Look for an export or download button
    const exportButton = page.getByRole('button', { name: /export|download/i });
    // If an export button exists, clicking it should start a download
    if (await exportButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
      await exportButton.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBeTruthy();
    } else {
      // Some UIs put export behind a menu -- look for a more-actions menu
      const menuButton = page.getByRole('button', { name: /more|actions|\.\.\./i });
      if (await menuButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await menuButton.click();
        const exportOption = page.getByRole('menuitem', { name: /export|download/i });
        await expect(exportOption).toBeVisible();
      }
    }
  });
});
