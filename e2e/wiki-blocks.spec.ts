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

  test('nothing can be typed before the session has synced, and what is typed then is saved', async ({
    page,
    request,
  }) => {
    const api = await wikiApi(request);
    const slug = `slow-sync-${Date.now()}`;
    await api.createPage(slug, 'Slow sync', 'Typed after this.');
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.routeWebSocket(/\/ws\/wiki/, (ws) => {
      const server = ws.connectToServer();
      const waiting: Array<string | Buffer> = [];
      let open = false;
      void held.then(() => {
        open = true;
        for (const message of waiting) server.send(message);
      });
      ws.onMessage((message) => (open ? server.send(message) : waiting.push(message)));
      server.onMessage((message) => ws.send(message));
    });

    await page.goto(`${WIKI_URL}/docs/${slug}/edit`);
    await expect(page.getByRole('status').getByText(/live session/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Typed after this.')).toBeVisible();
    await expect(page.locator('.ProseMirror')).toHaveCount(0);

    release();
    const editor = page.locator('.ProseMirror').first();
    await expect(editor.getByText('Typed after this.')).toBeVisible({ timeout: 15_000 });
    await editor.getByText('Typed after this.').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Kept.');
    await expect
      .poll(
        async () => {
          await api.flush(slug);
          return (await api.getPage(slug)).body as string;
        },
        { timeout: 15_000, intervals: [500] },
      )
      .toContain('Typed after this. Kept.');
  });

  test('text typed while the connection is lost is there after it comes back', async ({
    page,
    request,
  }) => {
    const api = await wikiApi(request);
    const slug = `lost-connection-${Date.now()}`;
    await api.createPage(slug, 'Lost connection', 'Before the drop.');
    let refuse = false;
    const sockets: Array<{ close: () => Promise<void> }> = [];
    await page.routeWebSocket(/\/ws\/wiki/, (ws) => {
      if (refuse) {
        void ws.close();
        return;
      }
      sockets.push(ws);
      const server = ws.connectToServer();
      ws.onMessage((message) => server.send(message));
      server.onMessage((message) => ws.send(message));
    });

    await page.goto(`${WIKI_URL}/docs/${slug}/edit`);
    const editor = page.locator('.ProseMirror').first();
    await expect(editor.getByText('Before the drop.')).toBeVisible({ timeout: 15_000 });

    refuse = true;
    await Promise.all(sockets.map((ws) => ws.close()));
    await expect(page.getByTitle('Editing offline')).toBeVisible({ timeout: 10_000 });
    await editor.getByText('Before the drop.').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Typed offline.');
    await expect(editor).toContainText('Typed offline.');

    refuse = false;
    await expect(page.getByTitle('Real-time sync active')).toBeVisible({ timeout: 30_000 });
    // The session ended with the connection, so the text comes back as a change to merge, and the
    // page is there once, not merged with a second copy from the new session
    await expect(editor.getByText('Before the drop.')).toHaveCount(1, { timeout: 15_000 });
    await expect
      .poll(async () => ((await api.getPage(slug)).body as string).trim(), {
        timeout: 15_000,
        intervals: [500],
      })
      .toBe('Before the drop. Typed offline.');
    await expect(page.getByText(/merge|changed/i).first()).toBeVisible({ timeout: 10_000 });
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
