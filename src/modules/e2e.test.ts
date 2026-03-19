import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../config/database';
import app from '../index';

describe('E2E: Full workflow', () => {
  let token: string;
  let _userId: string;
  let orgId: string;
  let teamId: string;
  let projectId: string;
  let spaceId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);
    const user = await prisma.user.upsert({
      where: { username: 'e2euser' },
      update: {},
      create: {
        email: 'e2e@axiom.dev',
        username: 'e2euser',
        displayName: 'E2E User',
        passwordHash,
      },
    });
    _userId = user.id;
  });

  afterAll(async () => {
    // Cleanup in reverse order of creation
    await prisma.comment.deleteMany({});
    await prisma.issue.deleteMany({});
    await prisma.boardColumn.deleteMany({});
    await prisma.pageVersion.deleteMany({});
    await prisma.page.deleteMany({});
    await prisma.wikiSpace.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.teamMembership.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.orgMembership.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.refreshToken.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
  });

  it('1. login user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        login: 'e2euser',
        password: 'testpassword123',
      });
    expect(res.status).toBe(200);
    token = res.body.accessToken;
  });

  it('2. create organization', async () => {
    const res = await request(app)
      .post('/api/orgs')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Axiom Corp', slug: 'axiom-corp' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('axiom-corp');
    orgId = res.body.id;
  });

  it('3. create team', async () => {
    const res = await request(app)
      .post(`/api/teams/org/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Backend', slug: 'backend', description: 'Backend team' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('backend');
    teamId = res.body.id;
  });

  it('4. create project with board columns', async () => {
    const res = await request(app)
      .post(`/api/projects/team/${teamId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'API', slug: 'api', prefix: 'API', description: 'API project' });
    expect(res.status).toBe(201);
    expect(res.body.columns).toHaveLength(5);
    expect(res.body.columns[0].name).toBe('Backlog');
    projectId = res.body.id;
  });

  it('5. create issue', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        title: 'Implement auth endpoint',
        body: '## Description\nBuild the auth endpoints',
        type: 'TASK',
        priority: 'HIGH',
      });
    expect(res.status).toBe(201);
    expect(res.body.key).toBe('API-1');
    expect(res.body.title).toBe('Implement auth endpoint');
  });

  it('6. create second issue and list', async () => {
    await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Fix login bug', type: 'BUG', priority: 'CRITICAL' });

    const res = await request(app)
      .get(`/api/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.issues[0].key).toBeDefined();
  });

  it('7. add comment to issue', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/issues/1/comments`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ body: 'Working on this now' });
    expect(res.status).toBe(201);
    expect(res.body.body).toBe('Working on this now');
  });

  it('8. get board view', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/board`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
    // Issues should be in Backlog (default column)
    const backlog = res.body.find((c: Record<string, unknown>) => c.name === 'Backlog');
    expect(backlog.issues.length).toBeGreaterThanOrEqual(1);
  });

  it('9. create wiki space', async () => {
    const res = await request(app)
      .post(`/api/wiki/team/${teamId}/spaces`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Engineering Docs', slug: 'eng-docs' });
    expect(res.status).toBe(201);
    spaceId = res.body.id;
  });

  it('10. create wiki pages with hierarchy', async () => {
    const parentRes = await request(app)
      .post(`/api/wiki/spaces/${spaceId}/pages`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Architecture', slug: 'architecture', body: '# Architecture\nOverview...' });
    expect(parentRes.status).toBe(201);

    const childRes = await request(app)
      .post(`/api/wiki/spaces/${spaceId}/pages`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        title: 'Database Schema',
        slug: 'database-schema',
        body: '# Database Schema\nPostgreSQL...',
        parentId: parentRes.body.id,
      });
    expect(childRes.status).toBe(201);
  });

  it('11. get page tree', async () => {
    const res = await request(app)
      .get(`/api/wiki/spaces/${spaceId}/tree`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1); // One root page
    expect(res.body[0].children).toHaveLength(1); // One child
    expect(res.body[0].children[0].title).toBe('Database Schema');
  });

  it('12. update wiki page and check versioning', async () => {
    await request(app)
      .patch(`/api/wiki/spaces/${spaceId}/pages/architecture`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ body: '# Architecture v2\nUpdated overview...' });

    const histRes = await request(app)
      .get(`/api/wiki/spaces/${spaceId}/pages/architecture/history`)
      .set('Authorization', `Bearer ${token}`);
    expect(histRes.status).toBe(200);
    expect(histRes.body).toHaveLength(2);
    expect(histRes.body[0].version).toBe(2);
  });

  it('13. search across issues and wiki', async () => {
    const res = await request(app)
      .get('/api/search?q=auth')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Should find the auth issue
    const issueResults = res.body.find((r: Record<string, unknown>) => r.type === 'issues');
    expect(issueResults.items.length).toBeGreaterThanOrEqual(1);
  });

  it('14. create API token', async () => {
    const res = await request(app)
      .post('/api/users/me/tokens')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'CI Token', scopes: ['issues:read', 'wiki:read'] });
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^tk_/);
    expect(res.body.prefix).toMatch(/^tk_/);

    // Use the token to authenticate
    const meRes = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Token ${res.body.token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.username).toBe('e2euser');
  });

  it('15. health check', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('axiom');
    expect(res.body.version).toBe('0.1.0-alpha');
  });
});
