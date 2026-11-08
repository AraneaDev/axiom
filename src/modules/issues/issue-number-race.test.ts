import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import { cleanupTestContext, createTestContext, type TestContext } from '../../test/factory';

import { createIssue } from './issues.service';

describe('issue numbers under concurrent creates', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext('number-race');
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  it('gives ten creates at once ten distinct numbers, none failing', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        createIssue(
          ctx.projectId,
          ctx.owner.id,
          { title: `Concurrent ${i}` },
          {
            skipAutomation: true,
          },
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0);
    const numbers = (
      await prisma.issue.findMany({ where: { projectId: ctx.projectId }, select: { number: true } })
    ).map((i) => i.number);
    expect(new Set(numbers).size).toBe(10);
  });
});
