import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import { createTestContext, cleanupTestContext } from '../../test/factory';

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');
const CLEANUP_START = '-- Data cleanup for removed git features';
const CLEANUP_END = '-- End data cleanup';

/** Load the data-cleanup section of the remove_git_hosting migration as separate statements. */
function loadCleanupStatements(): string[] {
  const dir = readdirSync(MIGRATIONS_DIR).find((d) => d.endsWith('_remove_git_hosting'));
  if (!dir) throw new Error('remove_git_hosting migration directory not found');
  const sql = readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');
  const start = sql.indexOf(CLEANUP_START);
  const end = sql.indexOf(CLEANUP_END);
  if (start === -1 || end === -1) throw new Error('cleanup section markers not found');
  const body = sql
    .slice(start, end)
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return body
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('remove_git_hosting migration data cleanup', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;
  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    ctx = await createTestContext('migclean');
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  it('removes stored git values and keeps everything else', async () => {
    const userId = ctx.owner.id;
    const projectId = ctx.projectId;

    await prisma.notification.createMany({
      data: [
        { userId, type: 'pr:review_requested', title: 'pr review' },
        { userId, type: 'pr:merged', title: 'pr merged' },
        { userId, type: 'issue:assigned', title: 'issue assigned' },
      ],
    });
    await prisma.notificationPreference.createMany({
      data: [
        { userId, eventType: 'pr_merged' },
        { userId, eventType: 'pr_review_requested' },
        { userId, eventType: 'issue_assigned' },
      ],
    });
    await prisma.automationRule.createMany({
      data: [
        { projectId, name: 'pr', trigger: 'pr:merged', actions: [{ type: 'add_label' }] },
        { projectId, name: 'wf1', trigger: 'workflow:completed', actions: [{ type: 'add_label' }] },
        { projectId, name: 'wf2', trigger: 'workflow:failed', actions: [{ type: 'add_label' }] },
        {
          projectId,
          name: 'mixed',
          trigger: 'issue:created',
          actions: [{ type: 'run_workflow' }, { type: 'add_label' }],
        },
        {
          projectId,
          name: 'only-removed',
          trigger: 'issue:created',
          actions: [{ type: 'run_workflow' }],
        },
        {
          projectId,
          name: 'untouched',
          trigger: 'issue:created',
          actions: [{ type: 'set_status' }],
        },
      ],
    });
    await prisma.activity.createMany({
      data: [
        { userId, resourceType: 'pull_request', resourceId: 'x', action: 'created' },
        { userId, resourceType: 'repository', resourceId: 'x', action: 'created' },
        { userId, resourceType: 'issue', resourceId: 'x', action: 'created' },
      ],
    });
    await prisma.apiToken.createMany({
      data: [
        {
          userId,
          name: 'mixed',
          tokenHash: `mig-a-${suffix}`,
          prefix: 'mig-a',
          scopes: ['repo:read', 'issues:write'],
        },
        {
          userId,
          name: 'plain',
          tokenHash: `mig-b-${suffix}`,
          prefix: 'mig-b',
          scopes: ['wiki:read'],
        },
      ],
    });
    const audit = await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        userId,
        action: 'pipeline.create',
        resource: 'pull_request:abc',
      },
    });

    for (const stmt of loadCleanupStatements()) {
      await prisma.$executeRawUnsafe(stmt);
    }

    const notifs = await prisma.notification.findMany({ where: { userId } });
    expect(notifs.map((n) => n.type)).toEqual(['issue:assigned']);

    const prefs = await prisma.notificationPreference.findMany({ where: { userId } });
    expect(prefs.map((p) => p.eventType)).toEqual(['issue_assigned']);

    const rules = await prisma.automationRule.findMany({ where: { projectId } });
    const byName = Object.fromEntries(rules.map((r) => [r.name, r]));
    expect(Object.keys(byName).sort()).toEqual(['mixed', 'untouched']);
    expect(byName.mixed.actions).toEqual([{ type: 'add_label' }]);
    expect(byName.untouched.actions).toEqual([{ type: 'set_status' }]);

    const acts = await prisma.activity.findMany({ where: { userId } });
    expect(acts.map((a) => a.resourceType)).toEqual(['issue']);

    const tokens = await prisma.apiToken.findMany({
      where: { userId },
      orderBy: { prefix: 'asc' },
    });
    expect(tokens.map((t) => t.scopes)).toEqual([['issues:write'], ['wiki:read']]);

    const auditAfter = await prisma.auditLog.findUnique({ where: { id: audit.id } });
    expect(auditAfter).not.toBeNull();
    expect(auditAfter?.resource).toBe('pull_request:abc');
  });
});
