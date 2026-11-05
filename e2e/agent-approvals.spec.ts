import { test, expect, type APIRequestContext } from '@playwright/test';

import { DEMO_USERS, login } from './helpers';

const HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };
const PROJECT_KEY = 'PLAT';

let sessionHeaders: Record<string, string> | undefined;

/** A signed-in session of the user: the one that creates things and sees them gone. Login is rate limited, so it signs in once. */
async function session(request: APIRequestContext) {
  if (sessionHeaders) return sessionHeaders;
  const res = await request.post('/api/auth/login', {
    headers: HEADERS,
    data: { login: DEMO_USERS.admin.login, password: DEMO_USERS.admin.password },
  });
  expect(res.status(), 'login').toBe(200);
  const { accessToken } = await res.json();
  sessionHeaders = { ...HEADERS, Authorization: `Bearer ${accessToken}` };
  return sessionHeaders;
}

async function createIssue(request: APIRequestContext, title: string): Promise<string> {
  const res = await request.post('/api/act', {
    headers: await session(request),
    data: { action: 'issue.create', key: PROJECT_KEY, input: { title } },
  });
  expect(res.status()).toBe(200);
  const issue = await res.json();
  return `${PROJECT_KEY}-${issue.number}`;
}

/** A token as an agent holds it: made once, used for every call after. */
async function createToken(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post('/api/users/me/tokens', {
    headers: await session(request),
    data: { name, scopes: ['issues:write', 'approvals:read', 'search:read'] },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).token;
}

/** The agent's call: a destructive action with a token waits for the user. */
async function askToDelete(request: APIRequestContext, token: string, key: string) {
  const res = await request.post('/api/act', {
    headers: { ...HEADERS, Authorization: `Token ${token}` },
    data: { action: 'issue.delete', key },
  });
  expect(res.status()).toBe(202);
  return res.json() as Promise<{ approvalId: string; approveUrl: string; preview: string }>;
}

async function issueExists(request: APIRequestContext, key: string): Promise<boolean> {
  const res = await request.post('/api/act', {
    headers: await session(request),
    data: { action: 'issue.get', key },
  });
  return res.status() === 200;
}

test.describe('Agent approvals', () => {
  test('approving from the notification runs the delete and shows it executed', async ({
    page,
    request,
  }) => {
    const key = await createIssue(request, 'Approve me to delete');
    const token = await createToken(request, 'e2e-approve');
    const pending = await askToDelete(request, token, key);
    expect(await issueExists(request, key), 'nothing ran before the decision').toBe(true);

    await login(page, DEMO_USERS.admin);
    await page.goto('/dashboard');
    const badge = page.getByTestId('agent-approvals-badge');
    await expect(badge).toBeVisible({ timeout: 15_000 });

    await page.locator('button[title="Notifications"]').click();
    await page
      .getByText(/e2e-approve wants to/)
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/approvals/agent/${pending.approvalId}$`));
    await expect(page.getByText(`through the token e2e-approve`)).toBeVisible();
    await expect(page.getByText(pending.preview)).toBeVisible();

    await page.getByRole('button', { name: /show input/i }).click();
    await expect(page.locator('pre')).toContainText(`"issueNumber": ${key.split('-')[1]}`);

    await page.getByRole('button', { name: /^approve$/i }).click();
    await expect(page.getByText('Executed', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /^approve$/i })).toHaveCount(0);
    expect(await issueExists(request, key), 'the approved delete ran').toBe(false);

    // Gone from the pending tab, present in the history
    await page.goto('/approvals/agent');
    await expect(page.getByRole('link', { name: pending.preview })).toHaveCount(0);
    await page.getByRole('tab', { name: /history/i }).click();
    await expect(page.getByRole('link', { name: pending.preview })).toBeVisible();
  });

  test('rejecting leaves the issue alone, and marking the notification read keeps the badge', async ({
    page,
    request,
  }) => {
    const key = await createIssue(request, 'Reject me');
    const token = await createToken(request, 'e2e-reject');
    const pending = await askToDelete(request, token, key);

    await login(page, DEMO_USERS.admin);
    await page.goto('/dashboard');
    await page.locator('button[title="Notifications"]').click();
    await page.getByRole('button', { name: /mark all read/i }).click();
    // A notification marked read is not a decided request
    await expect(page.getByTestId('agent-approvals-badge')).toBeVisible();

    await page.goto(`/approvals/agent/${pending.approvalId}`);
    await page.getByRole('button', { name: /^reject$/i }).click();
    await expect(page.getByText('Rejected', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/action never ran/)).toBeVisible();
    expect(await issueExists(request, key), 'the rejected delete did not run').toBe(true);
  });

  test('a request nobody decided shows as expired once its time is up', async ({
    page,
    request,
  }) => {
    const key = await createIssue(request, 'Let me expire');
    const token = await createToken(request, 'e2e-expire');
    const pending = await askToDelete(request, token, key);

    // Move the clock the page sees past the expiry: the server sends no event for it
    await page.clock.install();
    await login(page, DEMO_USERS.admin);
    await page.goto(`/approvals/agent/${pending.approvalId}`);
    await expect(page.getByRole('button', { name: /^approve$/i })).toBeVisible();
    await page.clock.fastForward('02:00:00');
    await expect(page.getByText(/expired before you decided/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /^approve$/i })).toHaveCount(0);
    expect(await issueExists(request, key), 'an expired request ran nothing').toBe(true);
  });

  test('a token an agent asked for shows once, to the person who approved it', async ({
    page,
    request,
  }) => {
    const created = await request.post('/api/users/me/tokens', {
      headers: await session(request),
      data: { name: 'e2e-admin-agent', scopes: ['admin:write', 'approvals:read'] },
    });
    expect(created.status()).toBe(201);
    const agentHeaders = { ...HEADERS, Authorization: `Token ${(await created.json()).token}` };

    const asked = await request.post('/api/users/me/tokens', {
      headers: agentHeaders,
      data: { name: 'e2e-asked-for', scopes: ['admin:read'], expiresInDays: 7 },
    });
    expect(asked.status()).toBe(202);
    const pending = await asked.json();
    expect(pending.preview).toContain('admin:read');
    expect(pending.preview).toContain('7 days');

    await login(page, DEMO_USERS.admin);
    await page.goto(`/approvals/agent/${pending.approvalId}`);
    await expect(page.getByText(pending.preview)).toBeVisible();
    await page.getByRole('button', { name: /^approve$/i }).click();

    const field = page.getByLabel('New token', { exact: true });
    await expect(field).toBeVisible({ timeout: 15_000 });
    const raw = await field.inputValue();
    expect(raw).toMatch(/^tk_/);

    // The agent that asked reads the outcome without it
    const read = await request.get(`/api/agent-approvals/${pending.approvalId}`, {
      headers: agentHeaders,
    });
    expect(read.status()).toBe(200);
    const outcome = await read.json();
    expect(outcome.status).toBe('EXECUTED');
    expect(JSON.stringify(outcome)).not.toContain(raw);

    // Shown once: it is gone after a reload
    await page.reload();
    await expect(page.getByText('Executed', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('New token', { exact: true })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(raw);
  });
});
