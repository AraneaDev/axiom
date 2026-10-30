import { test, expect } from '@playwright/test';

import { issuesApi, login, ORG, wikiApi } from './helpers';

const WIKI_URL = `/${ORG}/core/wiki`;

/** Each custom block of the seeded 'custom-blocks' page, exactly as the editor writes it */
const BLOCK_MARKDOWN = [
  '[TOC]',
  '> [!WARNING]\n> Careful with this.',
  '> [!DETAILS] More details\n> Hidden text.',
  '<span data-issue-key="PLAT-1" class="issue-ref">PLAT-1</span>',
  '<span class="mention">@Sarah Chen</span>',
  ':::issue PLAT-2:::',
  '<span url="http://localhost:7000/axiom/core/platform/issues/1" type="issue" title="Set up CI/CD pipeline" key="PLAT-1" status="Backlog" data-smart-link="" class="smart-link">PLAT-1 Set up CI/CD pipeline</span>',
];

test.describe('Wiki custom blocks', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('custom blocks render as node views and keep their Markdown through an edit', async ({
    page,
    request,
  }) => {
    const api = await wikiApi(request);
    await page.goto(`${WIKI_URL}/docs/custom-blocks/edit`);
    const editor = page.locator('.ProseMirror').first();
    await expect(editor.getByText('Edit this paragraph.')).toBeVisible({ timeout: 15_000 });

    // Table of contents lists the headings
    const toc = editor.locator('.node-tableOfContents');
    await expect(toc).toContainText('Table of Contents');
    await expect(toc).toContainText('Callout');
    await expect(toc).toContainText('References');
    // Callout with its type switcher
    const callout = editor.locator('.node-callout');
    await expect(callout).toContainText('Careful with this.');
    await expect(callout.getByTitle('Change callout type')).toBeVisible();
    // Collapsible with its editable title
    await expect(editor.locator('.node-collapsible input[type="text"]')).toHaveValue(
      'More details',
    );
    // Issue reference and mention
    await expect(editor.locator('[data-issue-key="PLAT-1"]')).toHaveText('PLAT-1');
    await expect(editor.locator('.mention')).toHaveText('@Sarah Chen');
    // Issue embed: its card, or its not-found card when search has not indexed the issue
    await expect(editor.locator('.node-issueEmbed')).toContainText('PLAT-2', { timeout: 10_000 });
    // Smart link card
    await expect(
      editor.locator('.node-smartLink a[title="PLAT-1: Set up CI/CD pipeline"]'),
    ).toBeVisible();
    // Rendered, not shown as source
    await expect(editor).not.toContainText('[!WARNING]');
    await expect(editor).not.toContainText(':::issue');

    // Edit a paragraph away from the blocks and save the session
    await editor.getByText('Edit this paragraph.').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Edited next to custom blocks.');
    await expect(editor).toContainText('Edited next to custom blocks.');

    await expect
      .poll(
        async () => {
          await api.flush('custom-blocks');
          return (await api.getPage('custom-blocks')).body as string;
        },
        { timeout: 15_000, intervals: [500] },
      )
      .toContain('Edit this paragraph. Edited next to custom blocks.');
    const { body } = await api.getPage('custom-blocks');
    for (const markdown of BLOCK_MARKDOWN) expect(body).toContain(markdown);
    expect(body).not.toContain('<paragraph');
  });

  test('a mention in an issue description survives an edit', async ({ page, request }) => {
    const issues = await issuesApi(request);
    const mention = '<span class="mention">@Sarah Chen</span>';
    const issue = await issues.create(
      `Mention survives ${Date.now()}`,
      `Ask ${mention} about this.\n\nEdit me.`,
    );

    await page.goto(`/${ORG}/core/platform/issues/${issue.number}`);
    await expect(page.getByText('Edit me.')).toBeVisible({ timeout: 15_000 });
    await page.getByText('Edit me.').hover();
    await page.getByTitle('Edit description').click();

    const editor = page.locator('.ProseMirror').first();
    await expect(editor.locator('.mention')).toHaveText('@Sarah Chen');
    await editor.getByText('Edit me.').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Edited.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect
      .poll(async () => (await issues.get(issue.number)).body as string, { timeout: 10_000 })
      .toContain('Edit me. Edited.');
    expect((await issues.get(issue.number)).body).toContain(mention);
  });
});
