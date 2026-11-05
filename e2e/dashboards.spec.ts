import { test, expect, type Page } from '@playwright/test';

import { DEMO_USERS, issuesApi, login } from './helpers';

/**
 * Resolves once the server has confirmed the page's realtime socket joined the room. Must be
 * called before the navigation that opens the socket.
 */
function subscribed(page: Page, room: string): Promise<void> {
  return new Promise((resolve) => {
    page.on('websocket', (ws) => {
      if (!new URL(ws.url()).pathname.endsWith('/ws')) return;
      ws.on('framereceived', (frame) => {
        if (typeof frame.payload !== 'string') return;
        try {
          const msg = JSON.parse(frame.payload) as { type?: string; room?: string };
          if (msg.type === 'subscribed' && msg.room === room) resolve();
        } catch {
          // Not JSON: not ours
        }
      });
    });
  });
}

test.describe('Dashboards', () => {
  test('a count widget follows a change to an issue without a reload', async ({ page }) => {
    test.setTimeout(90_000);
    const mark = `dashmark${Date.now()}`;
    const api = await issuesApi(page.request, DEMO_USERS.admin);
    const matching = await api.create(`First ${mark}`, 'Counted from the start');
    const other = await api.create('Not counted yet', 'Comes to match later');

    // The socket opens at login and stays through the client-side navigations below
    const joined = subscribed(page, `project:${api.projectId}`);
    await login(page, DEMO_USERS.admin);

    await page.getByRole('link', { name: 'Dashboards' }).click();
    await expect(page).toHaveURL(/\/dashboards$/);

    await page.getByRole('button', { name: 'New dashboard' }).first().click();
    const create = page.getByRole('dialog');
    await create.getByLabel('Name').fill(`Live ${mark}`);
    await create.getByRole('button', { name: 'Create' }).click();
    await expect(page).toHaveURL(/\/dashboards\/[^/]+\/edit$/);

    await page.getByRole('button', { name: 'Add widget' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Title').fill('Marked issues');
    await form.getByLabel('Query').fill(`title ~ ${mark}`);
    await form.getByRole('button', { name: 'Save widget' }).click();
    await expect(page.getByTestId('widget-row-Marked issues')).toBeVisible();

    await page.getByRole('link', { name: 'View' }).click();
    const count = page.getByTestId('widget-count');
    await expect(count).toHaveText('1', { timeout: 15_000 });
    await joined;

    let reloads = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) reloads++;
    });

    await api.update(other.number, { title: `Now ${mark}` });
    await expect(count).toHaveText('2', { timeout: 15_000 });

    await api.update(matching.number, { title: 'No longer counted' });
    await expect(count).toHaveText('1', { timeout: 15_000 });
    expect(reloads).toBe(0);
  });

  test('a broken widget shows its error while the others render', async ({ page }) => {
    const mark = `dashbroken${Date.now()}`;
    await login(page, DEMO_USERS.admin);
    const token = await page.evaluate(() => localStorage.getItem('accessToken'));
    expect(token).toBeTruthy();
    const headers = { Authorization: `Bearer ${token}`, 'X-Requested-With': 'XMLHttpRequest' };
    const created = await page.request.post('/api/dashboards', {
      headers,
      data: { name: mark },
    });
    const { id } = (await created.json()) as { id: string };
    for (const data of [
      { type: 'COUNT', title: 'Broken', query: 'nosuchfield = 1' },
      { type: 'COUNT', title: 'Fine', query: 'priority = HIGH' },
    ]) {
      const added = await page.request.post(`/api/dashboards/${id}/widgets`, { headers, data });
      expect(added.status()).toBe(201);
    }
    await page.goto(`/dashboards/${id}`);
    await expect(page.getByRole('alert').filter({ hasText: /nosuchfield/i })).toBeVisible();
    await expect(page.getByTestId('widget-count')).toBeVisible();
  });
});
