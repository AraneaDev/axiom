import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../../index';
import { prisma } from '../../config/database';

describe('Search API', () => {
  let token: string;
  let orgId: string;
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

    const org = await prisma.org.create({
      data: {
        name: 'Search Test Org',
        slug: 'search-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    orgId = org.id;

    const team = await prisma.team.create({
      data: {
        name: 'Search Test Team',
        slug: 'search-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    teamId = team.id;

    const loginRes = await request(app).post('/api/auth/login').send({
      login: 'search-test@axiom.dev',
      password: 'testpassword123',
    });
    token = loginRes.body.accessToken;

    // Create project (for issues)
    const projectRes = await request(app)
      .post(`/api/projects/team/${teamId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Search Test Project', slug: 'search-test-project', identifier: 'STP' });
    projectId = projectRes.body.id;

    // Create an issue with a unique title
    await request(app)
      .post(`/api/issues/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'UniqueSearchableIssueXYZ', description: 'Issue for search test' });

    // Create a wiki space and page
    const spaceRes = await request(app)
      .post(`/api/wiki/team/${teamId}/spaces`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Search Wiki Space', slug: 'search-wiki-space' });
    spaceId = spaceRes.body.id;

    await request(app)
      .post(`/api/wiki/spaces/${spaceId}/pages`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'UniqueSearchablePageXYZ',
        slug: 'unique-searchable-page-xyz',
        content: 'Wiki page for search test',
      });
  });

  afterAll(async () => {
    await prisma.org.deleteMany({ where: { slug: 'search-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'search-test-user' } });
    await prisma.$disconnect();
  });

  // 1. Search returns no results for non-existent query
  it('1. should return no results for a nonsense query', async () => {
    const res = await request(app)
      .get('/api/search?q=zzznoresultszzz99999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const results = res.body.results ?? res.body;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  // 2. Search issues by title
  it('2. should find an issue by title', async () => {
    const res = await request(app)
      .get('/api/search?q=UniqueSearchableIssueXYZ')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const results = res.body.results ?? res.body;
    expect(Array.isArray(results)).toBe(true);
    const found = results.find((r: { title?: string }) =>
      r.title?.includes('UniqueSearchableIssueXYZ'),
    );
    expect(found).toBeDefined();
  });

  // 3. Search wiki pages by title
  it('3. should find a wiki page by title', async () => {
    const res = await request(app)
      .get('/api/search?q=UniqueSearchablePageXYZ')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const results = res.body.results ?? res.body;
    const found = results.find((r: { title?: string }) =>
      r.title?.includes('UniqueSearchablePageXYZ'),
    );
    expect(found).toBeDefined();
  });

  // 4. Search with type filter: issues only
  it('4. should return only issues when type=issue', async () => {
    const res = await request(app)
      .get('/api/search?q=UniqueSearchable&type=issue')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const results = res.body.results ?? res.body;
    expect(Array.isArray(results)).toBe(true);
    results.forEach((r: { type: string }) => {
      expect(r.type).toBe('issue');
    });
  });

  // 5. Search with type filter: wiki only
  it('5. should return only wiki pages when type=wiki', async () => {
    const res = await request(app)
      .get('/api/search?q=UniqueSearchable&type=wiki')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const results = res.body.results ?? res.body;
    expect(Array.isArray(results)).toBe(true);
    results.forEach((r: { type: string }) => {
      expect(r.type).toBe('wiki');
    });
  });

  // 6. Verify result URL fields contain org/team slugs
  it('6. should include url fields with org and team slugs in results', async () => {
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
