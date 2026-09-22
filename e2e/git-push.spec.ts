import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { expect, test } from '@playwright/test';

// API-only test: no browser. It creates a repo and a webhook, pushes over HTTP
// through the web container's Vite proxy, and waits for a webhook delivery record.
// The webhook URL is unreachable on purpose; dispatchWebhook records failed
// deliveries too, so a delivery row proves the post-receive hook ran inside the
// container and reached the API, regardless of whether the delivery itself succeeds.
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:7000';
const HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };

// The E2E database is seeded by e2e/global-setup.ts, not scripts/seed-demo.ts:
// user "admin" / "password123", org slug "axiom", team slug "core".
const ORG_SLUG = 'axiom';
const TEAM_SLUG = 'core';

test('a push inside Docker reaches the post-receive handler', async ({ request }) => {
  const login = await request.post(`${BASE}/api/auth/login`, {
    headers: HEADERS,
    data: { login: 'admin', password: 'password123' },
  });
  expect(login.ok()).toBeTruthy();
  const auth = { ...HEADERS, Authorization: `Bearer ${(await login.json()).accessToken}` };

  const orgs = await (await request.get(`${BASE}/api/orgs`, { headers: auth })).json();
  const org = (Array.isArray(orgs) ? orgs : orgs.data).find(
    (o: { slug: string }) => o.slug === ORG_SLUG,
  );
  expect(org).toBeTruthy();

  const teams = await (
    await request.get(`${BASE}/api/teams/org/${org.id}`, { headers: auth })
  ).json();
  const team = (Array.isArray(teams) ? teams : teams.data).find(
    (t: { slug: string }) => t.slug === TEAM_SLUG,
  );
  expect(team).toBeTruthy();

  const slug = `push-e2e-${Date.now()}`;
  const repoRes = await request.post(`${BASE}/api/repos/team/${team.id}`, {
    headers: auth,
    data: { name: slug, slug },
  });
  expect(repoRes.ok()).toBeTruthy();
  const repo = await repoRes.json();

  const hookRes = await request.post(`${BASE}/api/repos/${repo.id}/webhooks`, {
    headers: auth,
    data: { url: 'https://example.invalid/axiom-e2e', events: ['*'] },
  });
  expect(hookRes.ok()).toBeTruthy();
  const webhook = await hookRes.json();

  const tokenRes = await request.post(`${BASE}/api/users/me/tokens`, {
    headers: auth,
    data: { name: slug, scopes: ['repo:read', 'repo:write'] },
  });
  const token = (await tokenRes.json()).token as string;

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-e2e-push-'));
  const remote = new URL(`/git/${ORG_SLUG}/${TEAM_SLUG}/${slug}.git`, BASE);
  remote.username = 'admin';
  remote.password = token;
  execFileSync('git', ['init', '-b', 'main', work]);
  fs.writeFileSync(path.join(work, 'README.md'), '# e2e');
  execFileSync('git', ['-C', work, 'add', '.']);
  execFileSync('git', [
    '-C',
    work,
    '-c',
    'user.name=E2E',
    '-c',
    'user.email=e2e@test.dev',
    'commit',
    '-m',
    'e2e',
  ]);
  execFileSync('git', ['-C', work, 'push', remote.toString(), 'main']);
  fs.rmSync(work, { recursive: true, force: true });

  await expect
    .poll(
      async () => {
        const res = await request.get(
          `${BASE}/api/repos/${repo.id}/webhooks/${webhook.id}/deliveries`,
          { headers: auth },
        );
        const body = await res.json();
        return (Array.isArray(body) ? body : (body.data ?? [])).length;
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);

  await request.delete(`${BASE}/api/repos/${repo.id}`, { headers: auth });
});
