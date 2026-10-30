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
import { authPost } from '../../test/helpers';

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
});
