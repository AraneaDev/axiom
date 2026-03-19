import bcrypt from 'bcryptjs';
import request from 'supertest';

import { prisma } from '../config/database';
import app from '../index';

export interface TestUser {
  id: string;
  email: string;
  username: string;
  token: string;
}

export interface TestContext {
  owner: TestUser;
  member?: TestUser;
  orgId: string;
  orgSlug: string;
  teamId: string;
  teamSlug: string;
  projectId: string;
  projectPrefix: string;
}

let counter = 0;

function uniqueSuffix(): string {
  return `${Date.now()}-${++counter}`;
}

/**
 * Create a user via Prisma upsert and obtain a JWT token by logging in.
 * @param overrides
 * @param overrides.email
 * @param overrides.username
 */
export async function createTestUser(overrides?: {
  email?: string;
  username?: string;
}): Promise<TestUser> {
  const suffix = uniqueSuffix();
  const email = overrides?.email ?? `factory-${suffix}@test.dev`;
  const username = overrides?.username ?? `factory-${suffix}`;
  const passwordHash = await bcrypt.hash('testpassword123', 4);

  const user = await prisma.user.upsert({
    where: { username },
    update: {},
    create: {
      email,
      username,
      displayName: username,
      passwordHash,
    },
  });

  const loginRes = await request(app)
    .post('/api/auth/login')
    .set('X-Requested-With', 'XMLHttpRequest')
    .send({ login: email, password: 'testpassword123' });

  return { id: user.id, email, username, token: loginRes.body.accessToken };
}

/**
 * Create a full test context: owner user + org + team + project.
 * An optional `label` keeps slugs unique across concurrent test suites.
 * @param label
 */
export async function createTestContext(label?: string): Promise<TestContext> {
  const tag = label ?? uniqueSuffix();

  const owner = await createTestUser({
    email: `ctx-owner-${tag}@test.dev`,
    username: `ctx-owner-${tag}`,
  });

  // Create org
  const orgRes = await request(app)
    .post('/api/orgs')
    .set('Authorization', `Bearer ${owner.token}`)
    .set('X-Requested-With', 'XMLHttpRequest')
    .send({ name: `Test Org ${tag}`, slug: `test-org-${tag}` });
  const orgId: string = orgRes.body.id;
  const orgSlug: string = orgRes.body.slug;

  // Create team
  const teamRes = await request(app)
    .post(`/api/teams/org/${orgId}`)
    .set('Authorization', `Bearer ${owner.token}`)
    .set('X-Requested-With', 'XMLHttpRequest')
    .send({ name: `Test Team ${tag}`, slug: `test-team-${tag}` });
  const teamId: string = teamRes.body.id;
  const teamSlug: string = teamRes.body.slug;

  // Create project (uses API so default board columns are created)
  const prefix = `T${tag.slice(0, 3).toUpperCase()}`;
  const projectRes = await request(app)
    .post(`/api/projects/team/${teamId}`)
    .set('Authorization', `Bearer ${owner.token}`)
    .set('X-Requested-With', 'XMLHttpRequest')
    .send({
      name: `Test Project ${tag}`,
      slug: `test-project-${tag}`,
      prefix,
    });
  const projectId: string = projectRes.body.id;

  return {
    owner,
    orgId,
    orgSlug,
    teamId,
    teamSlug,
    projectId,
    projectPrefix: prefix,
  };
}

/**
 * Add an extra member to an existing test context's org and team.
 * @param ctx
 * @param overrides
 * @param overrides.email
 * @param overrides.username
 */
export async function addMemberToContext(
  ctx: TestContext,
  overrides?: { email?: string; username?: string },
): Promise<TestUser> {
  const member = await createTestUser(overrides);

  // Add to org
  await prisma.orgMembership.create({
    data: { orgId: ctx.orgId, userId: member.id, role: 'MEMBER' },
  });

  // Add to team
  await prisma.teamMembership.create({
    data: { teamId: ctx.teamId, userId: member.id, role: 'MEMBER' },
  });

  return member;
}

/**
 * Clean up all data created by a test context.
 * Cascading deletes on Organization handle teams, projects, memberships, etc.
 * @param ctx
 */
export async function cleanupTestContext(ctx: TestContext): Promise<void> {
  await prisma.organization.deleteMany({ where: { id: ctx.orgId } });

  const usernames = [ctx.owner.username];
  if (ctx.member) usernames.push(ctx.member.username);

  await prisma.user.deleteMany({ where: { username: { in: usernames } } });
}
