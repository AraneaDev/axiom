import { test, expect, type Page } from '@playwright/test';

import { DEMO_USERS, ORG, issuesApi, login } from './helpers';

const BOARD_URL = `/${ORG}/core/platform/board`;

/**
 * Resolves once the server has confirmed the page's realtime socket joined the room (its
 * `subscribed` reply). Must be called before the navigation that opens the socket.
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

test.describe('Realtime board updates', () => {
  test("an issue created by one user appears on another user's open board without a reload", async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();
      const api = await issuesApi(ctxA.request, DEMO_USERS.admin);
      const room = `project:${api.projectId}`;

      await login(pageA, DEMO_USERS.admin);
      await login(pageB, DEMO_USERS.sarah);

      const subscribedA = subscribed(pageA, room);
      const subscribedB = subscribed(pageB, room);
      await pageA.goto(BOARD_URL);
      await pageB.goto(BOARD_URL);
      await expect(pageA.getByText('Backlog').first()).toBeVisible();
      await expect(pageB.getByText('Backlog').first()).toBeVisible();
      // Both boards joined the project room by id, and the server confirmed it
      await Promise.all([subscribedA, subscribedB]);

      // Track full reloads: the update has to arrive over the socket, not a navigation
      let reloadsB = 0;
      pageB.on('framenavigated', (frame) => {
        if (frame === pageB.mainFrame()) reloadsB++;
      });

      const title = `Realtime issue ${Date.now()}`;
      await api.create(title, 'Created through the API while both boards are open');

      await expect(pageB.getByText(title)).toBeVisible({ timeout: 10_000 });
      await expect(pageA.getByText(title)).toBeVisible({ timeout: 10_000 });
      expect(reloadsB).toBe(0);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
