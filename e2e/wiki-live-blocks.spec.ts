import { test, expect, type APIRequestContext } from '@playwright/test';

import { DEMO_USERS, issuesApi, login, ORG, wikiApi } from './helpers';

const WIKI_URL = `/${ORG}/core/wiki`;

/** The admin's API access, to set up what the browser then reads. */
async function adminApi(request: APIRequestContext) {
  const base = { 'X-Requested-With': 'XMLHttpRequest' };
  const res = await request.post('/api/auth/login', {
    headers: base,
    data: { login: DEMO_USERS.admin.login, password: DEMO_USERS.admin.password },
  });
  const { accessToken } = (await res.json()) as { accessToken: string };
  const headers = { ...base, Authorization: `Bearer ${accessToken}` };
  const post = async (url: string, data: object) => {
    const answer = await request.post(url, { headers, data });
    expect(answer.ok(), `${url}: ${answer.status()}`).toBe(true);
    return answer.json();
  };
  const orgs = (await (await request.get('/api/orgs', { headers })).json()) as { id: string }[];
  return { post, orgId: orgs[0].id };
}

test.describe('Live blocks in wiki pages', () => {
  test('a reader outside the dashboard sees it in a page, with their own numbers', async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const mark = `liveblock${Date.now()}`;
    const admin = await adminApi(request);

    // One matching issue the second user can see, one in a team of the admin alone
    const platform = await issuesApi(request, DEMO_USERS.admin);
    await platform.create(`Shared ${mark}`, 'In the team both are in');
    const team = await admin.post(`/api/teams/org/${admin.orgId}`, {
      name: `Hidden ${mark}`,
      slug: `hidden-${mark}`,
    });
    const project = await admin.post(`/api/projects/team/${team.id}`, {
      name: `Hidden ${mark}`,
      slug: `hidden-${mark}`,
      prefix: `H${Date.now() % 100000}`.replace(/\d/g, (d) => 'ABCDEFGHIJ'[Number(d)]),
    });
    await admin.post(`/api/projects/${project.id}/issues`, {
      title: `Hidden ${mark}`,
      body: 'Only its team sees this',
      type: 'TASK',
      priority: 'MEDIUM',
    });

    // Private to the admin
    const dashboard = await admin.post('/api/dashboards', { name: `Private ${mark}` });
    await admin.post(`/api/dashboards/${dashboard.id}/widgets`, {
      type: 'COUNT',
      title: 'Marked issues',
      query: `title ~ ${mark}`,
    });

    const inline = `title ~ "${mark}" GROUP BY project`;
    const wiki = await wikiApi(request);
    await wiki.createPage(
      `live-${mark}`,
      `Live ${mark}`,
      [
        'Before the block.',
        `:::query dashboard:${dashboard.id}:::`,
        `:::query inline:${JSON.stringify(inline)}:::`,
        'After the block.',
        '```',
        `:::query dashboard:${dashboard.id}:::`,
        '```',
      ].join('\n\n'),
    );
    const pageUrl = `${WIKI_URL}/docs/live-${mark}`;

    // The admin sees both issues
    await login(page, DEMO_USERS.admin);
    await page.goto(pageUrl);
    const blocks = page.getByTestId('query-block');
    await expect(blocks.first().getByTestId('widget-count')).toHaveText('2', { timeout: 15_000 });

    // The second user may not open the dashboard, and reads the page
    const context = await browser.newContext();
    const reader = await context.newPage();
    await login(reader, DEMO_USERS.marcus);
    const answers: string[] = [];
    reader.on('response', (response) => {
      if (/\/api\/dashboards\/embedded(\/batch)?$/.test(response.url())) {
        answers.push(response.url());
        void response.text().then((text) => answers.push(text));
      }
    });

    await reader.goto(`/dashboards/${dashboard.id}`);
    await expect(reader.getByText('Could not open this dashboard')).toBeVisible({
      timeout: 15_000,
    });

    await reader.goto(pageUrl);
    await expect(reader.getByText('Before the block.')).toBeVisible({ timeout: 15_000 });
    const theirs = reader.getByTestId('query-block');
    await expect(theirs.first().getByTestId('widget-count')).toHaveText('1', { timeout: 15_000 });
    await expect(theirs.first()).toContainText('Marked issues');
    // Not its name or anything else about it, and the inline block runs as well
    await expect(reader.getByText(`Private ${mark}`)).toHaveCount(0);
    await expect(theirs.nth(1)).toContainText('Platform');
    await expect(theirs.nth(1)).not.toContainText('Hidden');
    await expect(theirs).toHaveCount(2);
    // The line in the code block stays a line, the others are gone
    await expect(reader.locator('pre')).toContainText(`:::query dashboard:${dashboard.id}:::`);
    await expect(reader.getByText('After the block.')).toBeVisible();
    await expect.poll(() => answers.length).toBeGreaterThan(1);
    expect(answers.join(' ')).not.toContain(`title ~ ${mark}`);
    expect(answers.join(' ')).not.toContain(`Private ${mark}`);
    await context.close();
  });

  test('a block whose code cannot be fetched leaves the page standing', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const mark = `livefail${Date.now()}`;
    const admin = await adminApi(request);
    const dashboard = await admin.post('/api/dashboards', { name: `Fail ${mark}` });
    await admin.post(`/api/dashboards/${dashboard.id}/widgets`, {
      type: 'COUNT',
      title: 'Everything high',
      query: 'priority = HIGH',
    });
    const wiki = await wikiApi(request);
    const slug = `fail-${mark}`;
    await wiki.createPage(
      slug,
      `Fail ${mark}`,
      [
        'Text before.',
        `:::query dashboard:${dashboard.id}:::`,
        'Text between.',
        ':::query inline:"priority = HIGH":::',
        'Text after.',
      ].join('\n\n'),
    );

    await login(page, DEMO_USERS.admin);
    const chunk = /\/QueryBlock(\.tsx|-[^/]*\.js)/;
    await page.route(chunk, (route) => route.abort());

    await page.goto(`${WIKI_URL}/docs/${slug}`);
    const message = page.getByText('This block could not be loaded');
    await expect(message).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByText('Text before.')).toBeVisible();
    await expect(page.getByText('Text between.')).toBeVisible();
    await expect(page.getByText('Text after.')).toBeVisible();
    await expect(page.getByText('Something went wrong')).toHaveCount(0);

    // The same in the editor
    await page.goto(`${WIKI_URL}/docs/${slug}/edit`);
    const editor = page.locator('.ProseMirror').first();
    await expect(editor.getByText('This block could not be loaded')).toHaveCount(2, {
      timeout: 15_000,
    });
    await expect(editor.getByText('Text after.')).toBeVisible();

    // Chromium remembers the failed import, so a retry fails even with the code back. While
    // editing that leaves advice and no button: a reload would lose what is not saved
    await page.unroute(chunk);
    await editor.getByRole('button', { name: 'Try again' }).first().click();
    await expect(editor.getByText('Save the page first, then reload it.')).toBeVisible();
    await expect(editor.getByRole('button', { name: 'Reload page' })).toHaveCount(0);

    // A real reload brings the blocks back in the editor
    await page.reload();
    await expect(
      page.locator('.ProseMirror').first().getByTestId('widget-count').first(),
    ).toBeVisible({ timeout: 15_000 });

    // In view mode there is nothing to lose, so the block offers the reload itself. Blocked until
    // after the page has opened, in a document that has not loaded the code yet
    await page.route(chunk, (route) => route.abort());
    await page.goto(`${WIKI_URL}/docs/${slug}`);
    await expect(message).toHaveCount(2, { timeout: 15_000 });
    await page.unroute(chunk);
    await page.getByRole('button', { name: 'Try again' }).first().click();
    await page.getByRole('button', { name: 'Reload page' }).click();
    await expect(page.getByTestId('query-block').first().getByTestId('widget-count')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('query-block')).toHaveCount(2);
  });

  test('the slash menu puts a dashboard in a page, and the page keeps it', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const mark = `liveslash${Date.now()}`;
    const admin = await adminApi(request);
    const dashboard = await admin.post('/api/dashboards', { name: `Slash ${mark}` });
    await admin.post(`/api/dashboards/${dashboard.id}/widgets`, {
      type: 'COUNT',
      title: 'Everything high',
      query: 'priority = HIGH',
    });
    const wiki = await wikiApi(request);
    const slug = `slash-${mark}`;
    await wiki.createPage(slug, `Slash ${mark}`, 'Type below this.');

    await login(page, DEMO_USERS.admin);
    await page.goto(`${WIKI_URL}/docs/${slug}/edit`);
    const editor = page.locator('.ProseMirror').first();
    await editor.getByText('Type below this.').click({ timeout: 15_000 });
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    await page.keyboard.type('/Dashboard');
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    const picker = page.getByRole('dialog');
    await picker.getByTestId('dashboard-picker').getByRole('button').click();
    await picker.getByRole('button', { name: `Slash ${mark}` }).click();
    await picker.getByRole('button', { name: 'Add block' }).click();
    await expect(picker).toBeHidden();

    // Live in the editor before the page holds it, then saved as Markdown
    const block = editor.locator('.node-queryEmbed');
    await expect(block.getByTestId('widget-count')).toBeVisible({ timeout: 15_000 });
    await expect(block).toContainText('Everything high');
    await expect
      .poll(
        async () => {
          await wiki.flush(slug);
          return ((await wiki.getPage(slug)) as { body: string }).body;
        },
        { timeout: 20_000 },
      )
      .toContain(`:::query dashboard:${dashboard.id}:::`);

    // A query typed in the same form becomes an inline block, also when it looks like an id
    await editor
      .locator('.node-queryEmbed')
      .first()
      .click({ position: { x: 2, y: 2 } });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/Query');
    await page.getByRole('button', { name: 'Query', exact: true }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('button', { name: 'Inline query' }).click();
    await form.getByLabel('Query', { exact: true }).fill('priority = HIGH GROUP BY status');
    await form.getByRole('button', { name: 'Add block' }).click();
    await expect(editor.locator('.node-queryEmbed')).toHaveCount(2);
    await expect
      .poll(
        async () => {
          await wiki.flush(slug);
          return ((await wiki.getPage(slug)) as { body: string }).body;
        },
        { timeout: 20_000 },
      )
      .toContain(':::query inline:"priority = HIGH GROUP BY status":::');

    await page.goto(`${WIKI_URL}/docs/${slug}`);
    await expect(page.getByTestId('query-block').first().getByTestId('widget-count')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('query-block')).toHaveCount(2);
  });
});
