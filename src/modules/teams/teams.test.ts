import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../../index';
import { prisma } from '../../config/database';

describe('Teams API', () => {
  let token: string;
  let orgId: string;
  let teamId: string;
  let secondUserId: string;
  let teamMemberId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const owner = await prisma.user.upsert({
      where: { username: 'teams-test-owner' },
      update: {},
      create: {
        email: 'teams-test-owner@axiom.dev',
        username: 'teams-test-owner',
        displayName: 'Teams Test Owner',
        passwordHash,
      },
    });

    const secondUser = await prisma.user.upsert({
      where: { username: 'teams-test-member' },
      update: {},
      create: {
        email: 'teams-test-member@axiom.dev',
        username: 'teams-test-member',
        displayName: 'Teams Test Member',
        passwordHash,
      },
    });
    secondUserId = secondUser.id;

    const org = await prisma.org.create({
      data: {
        name: 'Teams Test Org',
        slug: 'teams-test-org',
        members: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    orgId = org.id;

    // Also add secondUser to org so they can be added to team
    await prisma.orgMember.create({
      data: { orgId: org.id, userId: secondUser.id, role: 'MEMBER' },
    });

    const loginRes = await request(app).post('/api/auth/login').send({
      login: 'teams-test-owner@axiom.dev',
      password: 'testpassword123',
    });
    token = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await prisma.org.deleteMany({ where: { slug: 'teams-test-org' } });
    await prisma.user.deleteMany({ where: { username: { in: ['teams-test-owner', 'teams-test-member'] } } });
    await prisma.$disconnect();
  });

  // 1. Create team in org
  it('1. should create a team in an org', async () => {
    const res = await request(app)
      .post(`/api/teams/org/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Teams Test Team', slug: 'teams-test-team' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('teams-test-team');
    expect(res.body.id).toBeDefined();
    teamId = res.body.id;
  });

  // 2. List teams by org
  it('2. should list teams for an org', async () => {
    const res = await request(app)
      .get(`/api/teams/org/${orgId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find((t: { id: string }) => t.id === teamId);
    expect(found).toBeDefined();
  });

  // 3. Get team
  it('3. should get a team by id', async () => {
    const res = await request(app)
      .get(`/api/teams/${teamId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('teams-test-team');
  });

  // 4. Update team
  it('4. should update team name', async () => {
    const res = await request(app)
      .patch(`/api/teams/${teamId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Teams Test Team Updated' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Teams Test Team Updated');
  });

  // 5. Add team member
  it('5. should add a member to the team', async () => {
    const res = await request(app)
      .post(`/api/teams/${teamId}/members`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: secondUserId, role: 'MEMBER' });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(secondUserId);
    teamMemberId = res.body.id;
  });

  // 6. List team members
  it('6. should list team members', async () => {
    const res = await request(app)
      .get(`/api/teams/${teamId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const members = res.body.members ?? [];
    const found = members.find((m: { userId: string }) => m.userId === secondUserId);
    expect(found).toBeDefined();
  });

  // 7. Create project in team
  it('7. should create a project in the team', async () => {
    const res = await request(app)
      .post(`/api/projects/team/${teamId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Teams Test Project', slug: 'teams-test-project', identifier: 'TTP' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('teams-test-project');
    expect(res.body.teamId).toBe(teamId);
  });
});
