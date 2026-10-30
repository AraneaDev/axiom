import { test, expect, type Page } from '@playwright/test';

import { login, ORG, wikiApi } from './helpers';

const WIKI_URL = `/${ORG}/core/wiki`;

/** Open the editor for a page and wait until the collaborative document has loaded. */
async function openEditor(page: Page, slug: string, firstText: string) {
  await page.goto(`${WIKI_URL}/docs/${slug}/edit`);
  const editor = page.locator('.ProseMirror').first();
  await expect(editor.getByText(firstText)).toBeVisible({ timeout: 15_000 });
  return editor;
}

/**
 * Save the live session until the stored body holds `typed`, and return that body.
 * @param api - The wiki API client
 * @param slug - The page
 * @param typed - Text typed in the editor
 */
async function bodyOnceFlushed(
  api: Awaited<ReturnType<typeof wikiApi>>,
  slug: string,
  typed: string,
): Promise<string> {
  let body = '';
  await expect
    .poll(
      async () => {
        await api.flush(slug);
        body = (await api.getPage(slug)).body;
        return body;
      },
      { timeout: 10_000, intervals: [250] },
    )
    .toContain(typed);
  return body;
}

/** Click at the end of the paragraph that starts with `text` and type `typed` there. */
async function typeAtEnd(page: Page, text: string, typed: string) {
  await page.locator('.ProseMirror p', { hasText: text }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(typed);
}

test.describe('Wiki live merge', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('a change in another block merges cleanly with Merge now', async ({ page, request }) => {
    const api = await wikiApi(request);
    const slug = `clean-merge-${Date.now()}`;
    await api.createPage(slug, 'Clean merge', 'Alpha block.\n\nBravo block.\n\nCharlie block.\n');

    const editor = await openEditor(page, slug, 'Alpha block.');
    await typeAtEnd(page, 'Alpha block.', ' Yours was typed here.');
    await expect(editor).toContainText('Yours was typed here.');
    // Save the session until the server holds the keystrokes, then the agent edits what it reads
    const current = await bodyOnceFlushed(api, slug, 'Yours was typed here.');

    const res = await api.patchPage(slug, {
      body: current.replace('Charlie block.', 'Charlie block. The agent added this.'),
    });
    expect(res.pendingMerge).toBe(true);
    expect(res.externalVersionId).toBeTruthy();

    await expect(page.getByText(/updated this page/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/1 change merges cleanly, 0 overlap/)).toBeVisible({
      timeout: 10_000,
    });
    // The editor still shows the session's text until the merge is applied
    await expect(editor).not.toContainText('The agent added this.');

    await page.getByRole('button', { name: 'Merge now' }).click();
    await expect(editor).toContainText('The agent added this.', { timeout: 10_000 });
    await expect(editor).toContainText('Yours was typed here.');
    await expect(page.getByText(/Merged by/)).toBeVisible({ timeout: 10_000 });

    const { body } = await api.getPage(slug);
    expect(body).toContain('Yours was typed here.');
    expect(body).toContain('The agent added this.');
    expect(body).not.toContain('<paragraph');
  });

  test('overlapping edits resolve per conflict and are recorded in the history', async ({
    page,
    request,
  }) => {
    const api = await wikiApi(request);
    const slug = `conflicts-${Date.now()}`;
    await api.createPage(slug, 'Conflicts', 'Block A text.\n\nBlock B text.\n\nBlock C text.\n');

    const editor = await openEditor(page, slug, 'Block A text.');
    // A first agent change, in block C only, so the session's edits below stay its own work
    await api.patchPage(slug, {
      body: 'Block A text.\n\nBlock B text.\n\nBlock C text. agent-C\n',
    });
    await expect(page.getByText(/updated this page/)).toBeVisible({ timeout: 10_000 });

    await typeAtEnd(page, 'Block A text.', ' yours-A');
    await typeAtEnd(page, 'Block B text.', ' yours-B');
    await expect(editor).toContainText('yours-B');
    // The server holds the keystrokes once the pending merge shows them as ours
    await expect
      .poll(async () => ((await api.pendingMerge(slug)) as { ours: string }).ours, {
        timeout: 10_000,
        intervals: [250],
      })
      .toContain('Block B text. yours-B');

    // The agent's second change overlaps both edits
    await api.patchPage(slug, {
      body: 'Block A text. agent-A\n\nBlock B text. agent-B\n\nBlock C text. agent-C\n',
    });

    await expect(page.getByText(/2 overlap with yours/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Review changes' }).click();

    await expect(page.getByText(/0 of 2 resolved/)).toBeVisible();
    const finish = page.getByRole('button', { name: /Finish\s+merge/ });
    await expect(finish).toBeDisabled();

    // Conflict 1 (block A): keep yours
    await page.getByRole('button', { name: /Conflict 1/ }).click();
    await page.getByRole('button', { name: 'Use Yours' }).click();
    // Conflict 2 (block B): take the agent's version, labelled with its author
    await page.getByRole('button', { name: /Conflict 2/ }).click();
    await page.getByRole('button', { name: 'Use Admin User' }).click();

    await expect(page.getByText(/2 of 2 resolved/)).toBeVisible();
    await expect(finish).toBeEnabled();
    await finish.click();

    await expect(editor).toContainText('yours-A', { timeout: 10_000 });
    await expect(editor).toContainText('agent-B');
    await expect(editor).not.toContainText('agent-A');
    await expect(editor).not.toContainText('yours-B');

    const { body } = await api.getPage(slug);
    expect(body).toContain('Block A text. yours-A');
    expect(body).toContain('Block B text. agent-B');
    expect(body).toContain('Block C text. agent-C');
    expect(body).not.toContain('agent-A');
    expect(body).not.toContain('yours-B');
    expect(body).not.toContain('<paragraph');

    const history: { kind: string }[] = await api.history(slug);
    const kinds = history.map((v) => v.kind);
    expect(kinds).toEqual(expect.arrayContaining(['SESSION_DRAFT', 'EXTERNAL', 'MERGE']));
  });
});
