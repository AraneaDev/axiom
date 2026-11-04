import { test, expect } from '@playwright/test';

import { login, ORG, wikiApi } from './helpers';

const WIKI_URL = `/${ORG}/core/wiki`;

/** A valid 2x2 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('Wiki images', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('an image uploaded through the slash command renders from a blob URL after reload', async ({
    page,
    request,
  }) => {
    const api = await wikiApi(request);
    const slug = `images-${Date.now()}`;
    await api.createPage(slug, 'Images', 'Image below.');

    await page.goto(`${WIKI_URL}/docs/${slug}/edit`);
    const editor = page.locator('.ProseMirror').first();
    await expect(editor.getByText('Image below.')).toBeVisible({ timeout: 15_000 });
    await editor.getByText('Image below.').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/Upload');

    const chooser = page.waitForEvent('filechooser');
    await page.getByText('Image: Upload file').click();
    (await chooser).setFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PNG });

    // The editor shows it through the auth-aware node view
    await expect(editor.getByRole('img', { name: 'pixel' })).toHaveAttribute('src', /^blob:/, {
      timeout: 15_000,
    });

    await expect
      .poll(
        async () => {
          await api.flush(slug);
          return (await api.getPage(slug)).body as string;
        },
        { timeout: 15_000, intervals: [500] },
      )
      .toMatch(/!\[pixel\]\(\/api\/attachments\/[A-Za-z0-9_-]+\)/);

    await page.goto(`${WIKI_URL}/docs/${slug}`);
    const img = page.locator('.prose img').first();
    await expect(img).toHaveAttribute('src', /^blob:/, { timeout: 15_000 });
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
  });

  test('an image that cannot be loaded shows a placeholder with its alt text', async ({
    page,
    request,
  }) => {
    const api = await wikiApi(request);
    const slug = `images-missing-${Date.now()}`;
    await api.createPage(slug, 'Missing image', '![gone file](/api/attachments/doesnotexist)');

    await page.goto(`${WIKI_URL}/docs/${slug}`);
    await expect(page.getByTestId('attachment-image-error')).toContainText('gone file', {
      timeout: 15_000,
    });
  });
});
