import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../config/database';
import { columnInOtherProject } from '../modules/issues/issue-board.service';
import { moveCrossesSpace } from '../modules/wiki/wiki.service';
import { cleanupTestContext, createTestContext, type TestContext } from '../test/factory';

describe('crossContainer checks read the database', () => {
  let ctx: TestContext;
  let otherCtx: TestContext;
  let spaceA: string;
  let spaceB: string;
  let pageInA: string;
  let childInA: string;
  let pageInB: string;

  beforeAll(async () => {
    ctx = await createTestContext(`cca-${Date.now()}`);
    otherCtx = await createTestContext(`ccb-${Date.now()}`);
    const mk = async (slug: string) =>
      (
        await prisma.wikiSpace.create({
          data: { teamId: ctx.teamId, name: slug, slug: `${slug}-${Date.now()}` },
        })
      ).id;
    spaceA = await mk('cc-a');
    spaceB = await mk('cc-b');
    const page = (spaceId: string, slug: string, parentId?: string) =>
      prisma.page
        .create({
          data: { spaceId, slug, title: slug, body: '', parentId },
        })
        .then((p) => p.id);
    pageInA = await page(spaceA, 'one');
    childInA = await page(spaceA, 'two');
    pageInB = await page(spaceB, 'three');
  });

  afterAll(async () => {
    await prisma.page.deleteMany({ where: { spaceId: { in: [spaceA, spaceB] } } });
    await prisma.wikiSpace.deleteMany({ where: { id: { in: [spaceA, spaceB] } } });
    await cleanupTestContext(ctx);
    await cleanupTestContext(otherCtx);
  });

  it('page: another space, by id or by the parent, crosses; the same space does not', async () => {
    expect(await moveCrossesSpace(pageInA, spaceB)).toBe(true);
    expect(await moveCrossesSpace(pageInA, spaceA)).toBe(false);
    expect(await moveCrossesSpace(pageInA, undefined, null)).toBe(false);
    expect(await moveCrossesSpace(pageInA, undefined, childInA)).toBe(false);
    expect(await moveCrossesSpace(pageInA, undefined, pageInB)).toBe(true);
    expect(await moveCrossesSpace('missing-page', spaceB)).toBe(false);
  });

  it("issue: a column of another project's board crosses; one of its own does not", async () => {
    const own = await prisma.boardColumn.create({
      data: { projectId: ctx.projectId, name: 'cc-own', position: 90 },
    });
    const foreign = await prisma.boardColumn.create({
      data: { projectId: otherCtx.projectId, name: 'cc-foreign', position: 90 },
    });
    expect(await columnInOtherProject(ctx.projectId, own.id)).toBe(false);
    expect(await columnInOtherProject(ctx.projectId, foreign.id)).toBe(true);
    expect(await columnInOtherProject(ctx.projectId, 'missing-column')).toBe(false);
  });
});
