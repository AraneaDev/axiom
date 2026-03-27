import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Search API', () => {
  let token: string;
  let _orgId: string;
  let teamId: string;
  let projectId: string;
  let spaceId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'search-test-user' },
      update: {},
      create: {
        email: 'search-test@axiom.dev',
        username: 'search-test-user',
        displayName: 'Search Test User',
        passwordHash,
      },
    });

    const org = await prisma.organization.create({
      data: {
        name: 'Search Test Org',
        slug: 'search-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    _orgId = org.id;

    const team = await prisma.team.create({
      data: {
        name: 'Search Test Team',
        slug: 'search-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });
    teamId = team.id;

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        login: 'search-test@axiom.dev',
        password: 'testpassword123',
      });
    token = loginRes.body.accessToken;

    // Create project (for issues)
    const projectRes = await request(app)
      .post(`/api/projects/team/${teamId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Search Test Project', slug: 'search-test-project', prefix: 'STP' });
    projectId = projectRes.body.id;

    // Create an issue with a unique title
    await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'UniqueSearchableIssueXYZ', description: 'Issue for search test' });

    // Create a wiki space and page
    const spaceRes = await request(app)
      .post(`/api/wiki/team/${teamId}/spaces`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Search Wiki Space', slug: 'search-wiki-space' });
    spaceId = spaceRes.body.id;

    await request(app)
      .post(`/api/wiki/spaces/${spaceId}/pages`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        title: 'UniqueSearchablePageXYZ',
        slug: 'unique-searchable-page-xyz',
        content: 'Wiki page for search test',
      });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'search-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'search-test-user' } });
    await prisma.$disconnect();
  });

  // 1. Search returns no results for non-existent query
  it('1. should return no results for a nonsense query', async () => {
    const res = await request(app)
      .get('/api/search?q=zzznoresultszzz99999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Response is an array of group objects: [{ type, items, total }]
    const groups = res.body;
    expect(Array.isArray(groups)).toBe(true);
    const totalItems = groups.reduce((sum: number, g: { total: number }) => sum + g.total, 0);
    expect(totalItems).toBe(0);
  });

  // 2. Search issues by title
  it('2. should find an issue by title', async () => {
    const res = await request(app)
      .get('/api/search?q=UniqueSearchableIssueXYZ&type=issues')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const groups = res.body;
    expect(Array.isArray(groups)).toBe(true);
    const issueGroup = groups.find((g: { type: string }) => g.type === 'issues');
    expect(issueGroup).toBeDefined();
    const found = issueGroup.items.find((r: { title?: string }) =>
      r.title?.includes('UniqueSearchableIssueXYZ'),
    );
    expect(found).toBeDefined();
  });

  // 3. Search wiki pages by title
  it('3. should find a wiki page by title', async () => {
    const res = await request(app)
      .get('/api/search?q=UniqueSearchablePageXYZ&type=wiki')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const groups = res.body;
    const wikiGroup = groups.find((g: { type: string }) => g.type === 'wiki');
    expect(wikiGroup).toBeDefined();
    const found = wikiGroup.items.find((r: { title?: string }) =>
      r.title?.includes('UniqueSearchablePageXYZ'),
    );
    expect(found).toBeDefined();
  });

  // 4. Search with type filter: issues only
  it('4. should return only issues when type=issues', async () => {
    const res = await request(app)
      .get('/api/search?q=UniqueSearchable&type=issues')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const groups = res.body;
    expect(Array.isArray(groups)).toBe(true);
    groups.forEach((g: { type: string }) => {
      expect(g.type).toBe('issues');
    });
  });

  // 5. Search with type filter: wiki only
  it('5. should return only wiki pages when type=wiki', async () => {
    const res = await request(app)
      .get('/api/search?q=UniqueSearchable&type=wiki')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const groups = res.body;
    expect(Array.isArray(groups)).toBe(true);
    groups.forEach((g: { type: string }) => {
      expect(g.type).toBe('wiki');
    });
  });

  // 6. Filter wiki results by spaceId
  it('6. should filter wiki results by spaceId', async () => {
    const res = await request(app)
      .get(`/api/search?q=UniqueSearchablePageXYZ&type=wiki&spaceId=${spaceId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const groups = res.body;
    const wikiGroup = groups.find((g: { type: string }) => g.type === 'wiki');
    expect(wikiGroup).toBeDefined();
    expect(wikiGroup.items.length).toBeGreaterThan(0);
    // All results should have the filtered spaceId
    wikiGroup.items.forEach((item: { spaceId: string }) => {
      expect(item.spaceId).toBe(spaceId);
    });
  });

  // 7. Filter wiki results by spaceId returns empty for wrong space
  it('7. should return no wiki results for non-matching spaceId', async () => {
    const res = await request(app)
      .get('/api/search?q=UniqueSearchablePageXYZ&type=wiki&spaceId=nonexistent-id')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const groups = res.body;
    const wikiGroup = groups.find((g: { type: string }) => g.type === 'wiki');
    expect(wikiGroup).toBeDefined();
    expect(wikiGroup.items.length).toBe(0);
  });

  // 8. Filter wiki results by label
  it('8. should filter wiki results by label', async () => {
    // First, add a label to our test page
    const searchRes = await request(app)
      .get('/api/search?q=UniqueSearchablePageXYZ&type=wiki')
      .set('Authorization', `Bearer ${token}`);
    const wikiGroup = searchRes.body.find((g: { type: string }) => g.type === 'wiki');
    const pageId = wikiGroup.items[0].id;

    // Add label via wiki API
    await request(app)
      .post(`/api/wiki/pages/${pageId}/labels`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ label: 'test-search-label' });

    // Now search with label filter
    const res = await request(app)
      .get('/api/search?q=UniqueSearchablePageXYZ&type=wiki&label=test-search-label')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const groups = res.body;
    const filtered = groups.find((g: { type: string }) => g.type === 'wiki');
    expect(filtered).toBeDefined();
    expect(filtered.items.length).toBeGreaterThan(0);
    // Verify the result has the label
    expect(filtered.items[0].labels).toContain('test-search-label');
  });

  // 9. Filter wiki results by date range
  it('9. should filter wiki results by date range', async () => {
    // Pages updated today should appear with since=today
    const today = new Date().toISOString().split('T')[0];
    const res = await request(app)
      .get(`/api/search?q=UniqueSearchablePageXYZ&type=wiki&since=${today}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const groups = res.body;
    const wikiGroup = groups.find((g: { type: string }) => g.type === 'wiki');
    expect(wikiGroup).toBeDefined();
    expect(wikiGroup.items.length).toBeGreaterThan(0);

    // Pages updated before 2020 should not appear
    const oldRes = await request(app)
      .get('/api/search?q=UniqueSearchablePageXYZ&type=wiki&until=2020-01-01')
      .set('Authorization', `Bearer ${token}`);
    expect(oldRes.status).toBe(200);
    const oldGroups = oldRes.body;
    const oldWikiGroup = oldGroups.find((g: { type: string }) => g.type === 'wiki');
    expect(oldWikiGroup).toBeDefined();
    expect(oldWikiGroup.items.length).toBe(0);
  });

  // 10. Accessible spaces endpoint
  it('10. should return accessible spaces', async () => {
    const res = await request(app)
      .get('/api/search/spaces')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const space = res.body.find((s: { id: string }) => s.id === spaceId);
    expect(space).toBeDefined();
    expect(space.name).toBe('Search Wiki Space');
  });

  // 11. Verify result URL fields contain org/team slugs
  it('11. should include url fields with org and team slugs in results', async () => {
    const res = await request(app)
      .get('/api/search?q=UniqueSearchable')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const results = res.body.results ?? res.body;
    expect(results.length).toBeGreaterThan(0);
    results.forEach((r: { url?: string }) => {
      if (r.url) {
        expect(r.url).toContain('search-test-org');
      }
    });
  });
});
