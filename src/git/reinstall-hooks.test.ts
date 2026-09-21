import fs from 'fs/promises';
import path from 'path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../config/database';
import { cleanupTestContext, createTestContext, type TestContext } from '../test/factory';
import { authPost } from '../test/helpers';

import { reinstallAllHooks } from './reinstall-hooks';

describe('repository hooks', () => {
  let ctx: TestContext;
  let repoId: string;
  let diskPath: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    const res = await authPost(`/api/repos/team/${ctx.teamId}`, ctx.owner.token, {
      name: 'Hooked',
      slug: 'hooked',
    });
    repoId = res.body.id;
    diskPath = res.body.diskPath;
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  it('installs a hook when a repository is created', async () => {
    const hook = await fs.readFile(path.join(diskPath, 'hooks', 'post-receive'), 'utf8');
    expect(hook).toContain(`"${repoId}"`);
  });

  it('installs a hook when a repository is forked', async () => {
    const res = await authPost(`/api/repos/${repoId}/fork`, ctx.owner.token, {
      targetTeamId: ctx.teamId,
      slug: 'hooked-fork',
    });
    expect(res.status).toBeLessThan(300);
    const hook = await fs.readFile(path.join(res.body.diskPath, 'hooks', 'post-receive'), 'utf8');
    expect(hook).toContain(`"${res.body.id}"`);
  });

  it('rewrites old hooks and skips repos missing on disk', async () => {
    const hookPath = path.join(diskPath, 'hooks', 'post-receive');
    await fs.writeFile(hookPath, '#!/bin/bash\ncurl -H "X-Hook-Secret: leaked" http://old\n');

    const ghost = await prisma.repository.create({
      data: {
        teamId: ctx.teamId,
        name: 'Ghost',
        slug: 'ghost',
        diskPath: path.join(diskPath, '..', 'does-not-exist.git'),
      },
    });

    const result = await reinstallAllHooks();

    const hook = await fs.readFile(hookPath, 'utf8');
    expect(hook).not.toContain('leaked');
    expect(hook.startsWith('#!/bin/sh')).toBe(true);
    expect(result.installed).toBeGreaterThanOrEqual(1);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    await prisma.repository.delete({ where: { id: ghost.id } });
  });
});
