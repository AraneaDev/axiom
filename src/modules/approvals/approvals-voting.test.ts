/**
 * Only the approvers named on a request can vote on it, and a requester can't approve
 * their own request unless the gate allows self-approval.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authPatch, authPost } from '../../test/helpers';
import { evaluateRules } from '../automation/automation.service';

describe('Approval voting', () => {
  let ctx: TestContext;
  let approver: TestUser;
  let bystander: TestUser;
  let issueId: string;
  let gateId: string;
  let toColumnId: string;

  beforeAll(async () => {
    ctx = await createTestContext(`apvote${Date.now()}`);
    approver = await addMemberToContext(ctx);
    bystander = await addMemberToContext(ctx);
    const cols = await prisma.boardColumn.findMany({
      where: { projectId: ctx.projectId },
      orderBy: { position: 'asc' },
      take: 2,
    });
    toColumnId = cols[1].id;
    gateId = (
      await prisma.approvalGate.create({
        data: {
          projectId: ctx.projectId,
          fromColumnId: cols[0].id,
          toColumnId,
          minApprovals: 1,
          allowSelfApproval: false,
        },
      })
    ).id;
    issueId = (
      await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: 1,
          title: 'Gated',
          body: '',
          creatorId: ctx.owner.id,
          columnId: cols[0].id,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: { in: [approver.id, bystander.id] } } });
  });

  it('lets only the named approvers vote', async () => {
    const created = await authPost(
      `/api/issues/${issueId}/approval-requests/${toColumnId}`,
      ctx.owner.token,
      { approverIds: [approver.id] },
    );
    expect(created.status).toBe(201);
    const requestId = created.body.id as string;

    const byBystander = await authPost(
      `/api/approval-requests/${requestId}/vote`,
      bystander.token,
      {
        decision: 'APPROVED',
      },
    );
    const byRequester = await authPost(
      `/api/approval-requests/${requestId}/vote`,
      ctx.owner.token,
      {
        decision: 'APPROVED',
      },
    );
    expect([byBystander.status, byRequester.status]).toEqual([403, 403]);
    expect(await prisma.approvalVote.count({ where: { approvalRequestId: requestId } })).toBe(0);

    const byApprover = await authPost(`/api/approval-requests/${requestId}/vote`, approver.token, {
      decision: 'APPROVED',
    });
    expect(byApprover.status).toBeLessThan(300);
  });

  it('refuses a self-vote on a request without stored approvers when the gate forbids it', async () => {
    const legacy = await prisma.approvalRequest.create({
      data: {
        issueId,
        approvalGateId: gateId,
        targetColumnId: toColumnId,
        requestedById: ctx.owner.id,
      },
    });
    const res = await authPost(`/api/approval-requests/${legacy.id}/vote`, ctx.owner.token, {
      decision: 'APPROVED',
    });
    expect(res.status).toBe(403);
  });

  it('refuses every direct move into a gated column; an approval still moves it', async () => {
    const fromColumnId = (await prisma.approvalGate.findUniqueOrThrow({ where: { id: gateId } }))
      .fromColumnId;
    const gated = await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 2,
        title: 'Must be approved',
        body: '',
        creatorId: ctx.owner.id,
        columnId: fromColumnId,
      },
    });
    const P = `/api/projects/${ctx.projectId}`;
    const t = approver.token;
    const update = await authPatch(`${P}/issues/2`, t, { columnId: toColumnId });
    const move = await authPatch(`${P}/issues/2/move`, t, { columnId: toColumnId, position: 0 });
    const bulk = await authPatch(`${P}/issues/bulk`, t, {
      issueIds: [gated.id],
      updates: { status: toColumnId },
    });
    expect([update.status, move.status, bulk.status]).toEqual([409, 409, 409]);

    // Automation set_status can't skip the gate either
    const rule = await prisma.automationRule.create({
      data: {
        projectId: ctx.projectId,
        name: 'skip the gate',
        trigger: 'issue:created',
        actions: [{ type: 'set_status', columnId: toColumnId }],
      },
    });
    await evaluateRules(ctx.projectId, 'issue:created', {
      issue: { ...gated, projectId: ctx.projectId },
      actorId: ctx.owner.id,
    } as never);
    await prisma.automationRule.delete({ where: { id: rule.id } });
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: gated.id } })).columnId).toBe(
      fromColumnId,
    );

    // The approval path moves it
    const created = await authPost(
      `/api/issues/${gated.id}/approval-requests/${toColumnId}`,
      ctx.owner.token,
      { approverIds: [approver.id] },
    );
    expect(created.status).toBe(201);
    const vote = await authPost(`/api/approval-requests/${created.body.id}/vote`, t, {
      decision: 'APPROVED',
    });
    expect(vote.status).toBeLessThan(300);
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: gated.id } })).columnId).toBe(
      toColumnId,
    );
  });

  it('10: a legacy request without approvers needs issue:edit to vote', async () => {
    const viewer = await addMemberToContext(ctx);
    await prisma.teamMembership.update({
      where: { userId_teamId: { userId: viewer.id, teamId: ctx.teamId } },
      data: { role: 'VIEWER' },
    });
    try {
      const legacy = await prisma.approvalRequest.create({
        data: {
          issueId,
          approvalGateId: gateId,
          targetColumnId: toColumnId,
          requestedById: ctx.owner.id,
        },
      });
      const res = await authPost(`/api/approval-requests/${legacy.id}/vote`, viewer.token, {
        decision: 'APPROVED',
      });
      expect(res.status).toBe(403);
    } finally {
      await prisma.user.deleteMany({ where: { id: viewer.id } });
    }
  });

  it('N8: a gate guards entry into its column from any source', async () => {
    const cols = await prisma.boardColumn.findMany({
      where: { projectId: ctx.projectId },
      orderBy: { position: 'asc' },
    });
    const elsewhere = cols.find((c) => c.id !== toColumnId && c.position > 1) ?? cols[2];
    const fromOther = await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 30,
        title: 'From another column',
        body: '',
        creatorId: ctx.owner.id,
        columnId: elsewhere.id,
      },
    });
    const noColumn = await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 31,
        title: 'No column',
        body: '',
        creatorId: ctx.owner.id,
      },
    });
    const P = `/api/projects/${ctx.projectId}`;
    const a = await authPatch(`${P}/issues/30`, approver.token, { columnId: toColumnId });
    const b2 = await authPatch(`${P}/issues/31`, approver.token, { columnId: toColumnId });
    expect([a.status, b2.status]).toEqual([409, 409]);

    // The approval path works from that column too
    const created = await authPost(
      `/api/issues/${fromOther.id}/approval-requests/${toColumnId}`,
      ctx.owner.token,
      { approverIds: [approver.id] },
    );
    expect(created.status).toBe(201);
    void noColumn;
  });
});
