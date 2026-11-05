/**
 * Org slugs that an app route would shadow: /:org is the last thing the router tries, so an org
 * called dashboards would never reach its own page.
 */
import { readFileSync } from 'fs';
import path from 'path';

import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import { createTestUser, type TestUser } from '../../test/factory';
import { authGet, authPatch, authPost } from '../../test/helpers';
import { RESERVED_ORG_SLUGS } from '../../utils/validation/common-validators';

const ROUTER_FILES = ['App.tsx', 'routes/admin-routes.tsx', 'routes/project-routes.tsx'].map(
  (file) => path.join(process.cwd(), 'frontend/src', file),
);

/**
 * The first segment of every route with a literal start in the app's router.
 * @param source - The router's source
 */
function topLevelRoutes(source: string): string[] {
  const segments = [...source.matchAll(/path="\/([a-z0-9-]+)/g)].map((match) => match[1]);
  return [...new Set(segments)];
}

describe('reserved org slugs', () => {
  const created: string[] = [];
  let user: TestUser | undefined;
  const owner = async () => (user ??= await createTestUser());

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: created } } });
    if (user) await prisma.user.delete({ where: { id: user.id } });
  });

  it.each(['dashboard', 'dashboards', 'admin', 'login', 'orgs', 'settings', 'api', 'setup-2fa'])(
    'refuses a new org called %s',
    async (slug) => {
      const res = await authPost('/api/orgs', (await owner()).token, { name: 'Taken', slug });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/reserved/i);
      expect(await prisma.organization.count({ where: { slug } })).toBe(0);
    },
  );

  it('covers every top-level route the app has', () => {
    const routes = topLevelRoutes(
      ROUTER_FILES.map((file) => readFileSync(file, 'utf8')).join('\n'),
    );
    expect(routes).toEqual(expect.arrayContaining(['dashboards', 'admin', 'settings', 'search']));
    expect(routes.filter((route) => !RESERVED_ORG_SLUGS.has(route))).toEqual([]);
  });

  it('still takes a slug that only starts like one', async () => {
    const res = await authPost('/api/orgs', (await owner()).token, {
      name: 'Fine',
      slug: `dashboards-of-${Date.now()}`,
    });
    expect(res.status).toBe(201);
    created.push(res.body.id);
  });

  it('leaves an org that already has such a slug working', async () => {
    const me = await owner();
    const org = await prisma.organization.create({
      data: {
        name: 'From before',
        slug: 'dashboards',
        members: { create: { userId: me.id, role: 'OWNER' } },
      },
    });
    created.push(org.id);
    expect((await authGet(`/api/orgs/${org.id}`, me.token)).status).toBe(200);
    const renamed = await authPatch(`/api/orgs/${org.id}`, me.token, { name: 'Renamed' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.slug).toBe('dashboards');
  });
});
