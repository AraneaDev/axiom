import { type APIRequestContext, type Page } from '@playwright/test';

export const DEMO_USERS = {
  admin: { login: 'admin', password: 'password123', display: 'Admin User' },
  sarah: { login: 'sarah-chen', password: 'password123', display: 'Sarah Chen' },
  marcus: { login: 'marcus-kim', password: 'password123', display: 'Marcus Kim' },
};

export const BASE = 'http://localhost:7000';
export const ORG = 'axiom';

/** Log in and land on the dashboard. */
export async function login(page: Page, user = DEMO_USERS.admin) {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(user.login);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Wait for redirect away from /login (the app lands on '/dashboard')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
}

/** Log out via the header user menu; logging out returns to the landing page at '/'. */
export async function logout(page: Page) {
  await page
    .getByRole('button', { name: /admin user|sarah chen|marcus kim/i })
    .first()
    .click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('/');
}

/** Links to individual issues (`.../issues/<number>`), excluding the "new issue" link. */
export function issueLinks(page: Page) {
  return page.locator('a[href*="/issues/"]:not([href$="/issues/new"])');
}

/** A small authenticated API client for specs that set up or inspect wiki pages directly. */
export async function wikiApi(request: APIRequestContext, user = DEMO_USERS.admin) {
  const base = { 'X-Requested-With': 'XMLHttpRequest' };
  const loginRes = await request.post('/api/auth/login', {
    headers: base,
    data: { login: user.login, password: user.password },
  });
  const { accessToken } = await loginRes.json();
  const h = { ...base, Authorization: `Bearer ${accessToken}` };

  const orgs = await (await request.get('/api/orgs', { headers: h })).json();
  const teams = await (await request.get(`/api/teams/org/${orgs[0].id}`, { headers: h })).json();
  const spaces = await (
    await request.get(`/api/wiki/team/${teams.data[0].id}/spaces`, { headers: h })
  ).json();
  const spaceId: string = spaces.find((s: { slug: string }) => s.slug === 'docs').id;
  const pageUrl = (slug: string) => `/api/wiki/spaces/${spaceId}/pages/${slug}`;

  return {
    spaceId,
    async createPage(slug: string, title: string, body: string) {
      const res = await request.post(`/api/wiki/spaces/${spaceId}/pages`, {
        headers: h,
        data: { title, slug, body },
      });
      if (res.status() !== 201) throw new Error(`createPage failed: ${res.status()}`);
      return res.json();
    },
    async getPage(slug: string) {
      return (await request.get(pageUrl(slug), { headers: h })).json();
    },
    async patchPage(slug: string, data: Record<string, unknown>) {
      const res = await request.patch(pageUrl(slug), { headers: h, data });
      if (!res.ok()) throw new Error(`patchPage failed: ${res.status()}`);
      return res.json();
    },
    async history(slug: string) {
      return (await request.get(`${pageUrl(slug)}/history`, { headers: h })).json();
    },
    /** Save the page's live editing session now, as the editor's Save does. */
    async flush(slug: string) {
      const res = await request.post(`${pageUrl(slug)}/collab/flush`, { headers: h, data: {} });
      if (!res.ok()) throw new Error(`flush failed: ${res.status()}`);
      return res.json();
    },
    /** The pending merge (base, ours, theirs), or null when nothing is pending. */
    async pendingMerge(slug: string) {
      return (await request.get(`${pageUrl(slug)}/pending-merge`, { headers: h })).json();
    },
  };
}

/** A small authenticated API client for the seeded Platform project's issues. */
export async function issuesApi(request: APIRequestContext, user = DEMO_USERS.admin) {
  const base = { 'X-Requested-With': 'XMLHttpRequest' };
  const loginRes = await request.post('/api/auth/login', {
    headers: base,
    data: { login: user.login, password: user.password },
  });
  const { accessToken } = await loginRes.json();
  const h = { ...base, Authorization: `Bearer ${accessToken}` };

  const orgs = await (await request.get('/api/orgs', { headers: h })).json();
  const teams = await (await request.get(`/api/teams/org/${orgs[0].id}`, { headers: h })).json();
  const projects = await (
    await request.get(`/api/projects/team/${teams.data[0].id}`, { headers: h })
  ).json();
  const list: { id: string; slug: string }[] = Array.isArray(projects) ? projects : projects.data;
  const projectId = list.find((p) => p.slug === 'platform')!.id;

  return {
    projectId,
    async create(title: string, body: string) {
      const res = await request.post(`/api/projects/${projectId}/issues`, {
        headers: h,
        data: { title, body, type: 'TASK', priority: 'MEDIUM' },
      });
      if (res.status() !== 201) throw new Error(`create issue failed: ${res.status()}`);
      return res.json() as Promise<{ number: number }>;
    },
    async get(number: number) {
      return (
        await request.get(`/api/projects/${projectId}/issues/${number}`, { headers: h })
      ).json();
    },
  };
}
