import { test, expect } from '@playwright/test';
import { login, ORG } from './helpers';

const PALETTE_PLACEHOLDER = /^Search issues and wiki/;

test.describe('Command Palette / Search', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('search bar is visible in header', async ({ page }) => {
    await expect(page.getByText('Search anything...')).toBeVisible();
  });

  test('clicking search bar opens command palette', async ({ page }) => {
    await page.getByText('Search anything...').click();
    await expect(page.getByPlaceholder(PALETTE_PLACEHOLDER)).toBeVisible();
  });

  test('Cmd+K opens command palette', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await expect(page.getByPlaceholder(PALETTE_PLACEHOLDER)).toBeVisible();
  });

  test('Escape closes command palette', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await expect(page.getByPlaceholder(PALETTE_PLACEHOLDER)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByPlaceholder(PALETTE_PLACEHOLDER)).not.toBeVisible();
  });

  test('clicking backdrop closes command palette', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    // Click outside the palette (top-left corner)
    await page.mouse.click(10, 10);
    await expect(page.getByPlaceholder(PALETTE_PLACEHOLDER)).not.toBeVisible();
  });

  test('typing a query returns results', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await page.getByPlaceholder(PALETTE_PLACEHOLDER).fill('dark mode');
    // Wait for debounce + API response
    await page.waitForTimeout(500);
    await expect(page.locator('button').filter({ hasText: /dark mode/i }).first()).toBeVisible({ timeout: 5_000 });
  });

  test('selecting a result navigates correctly', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await page.getByPlaceholder(PALETTE_PLACEHOLDER).fill('dark mode');
    await page.waitForTimeout(500);
    const firstResult = page.locator('button[type="button"]').filter({ hasText: /dark mode/i }).first();
    await firstResult.click();
    // Should navigate to a valid page (not stay on current or go to broken URL)
    await expect(page).not.toHaveURL('/login');
    const url = page.url();
    // URL must match our route patterns
    expect(url).toMatch(/\/(issues\/\d+|wiki\/)/);
  });

  test('no results message for nonsense query', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await page.getByPlaceholder(PALETTE_PLACEHOLDER).fill('xyzzy_nonexistent_zzz');
    await page.waitForTimeout(500);
    await expect(page.getByText(/no results found/i)).toBeVisible({ timeout: 5_000 });
  });

  test('command palette renders in document body (no stacking context bug)', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    // The palette overlay must be a direct child of body, not inside header
    const overlay = page.locator('body > div.fixed.inset-0');
    await expect(overlay).toBeVisible();
  });
});
