/**
 * Decision 12: a bot's owners count as self on an issue approval gate. Where the gate does not
 * allow self-approval, none of them may be named on, or vote on, a request the bot raised.
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

import { createApprovalRequestWithTarget } from './approvals.service';

describe('approval gates: a bot raises the request', () => {
  let ctx: TestContext;
  let botOwner: TestUser;
  let colleague: TestUser;
  let botId: string;
  let issueId: string;
  let toColumnId: string;
  let gateId: string;

  beforeAll(async () => {
    ctx = await createTestContext(`apbot${Date.now()}`);
    botOwner = await addMemberToContext(ctx);
    colleague = await addMemberToContext(ctx);
    const bot = await prisma.user.create({
      data: {
        email: `acme-gatebot-${Date.now()}@example.invalid`,
        username: `acme-gatebot-${Date.now()}`,
        displayName: 'Acme gate bot',
        passwordHash: '!',
        kind: 'SERVICE',
      },
    });
    botId = bot.id;
    await prisma.serviceAccount.create({
      data: { userId: botId, orgId: ctx.orgId, owners: { create: { ownerId: botOwner.id } } },
    });
    await prisma.orgMembership.create({
      data: { orgId: ctx.orgId, userId: botId, role: 'MEMBER' },
    });
    await prisma.teamMembership.create({
      data: { teamId: ctx.teamId, userId: botId, role: 'MEMBER' },
    });
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
          title: 'Gated by a bot',
          body: '',
          creatorId: botId,
          columnId: cols[0].id,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: { in: [botOwner.id, colleague.id, botId] } } });
  });

  it("refuses to name the bot's owner as an approver of the bot's request", async () => {
    await expect(
      createApprovalRequestWithTarget(issueId, toColumnId, botId, [botOwner.id]),
    ).rejects.toMatchObject({ statusCode: 400, code: 'SELF_APPROVAL_NOT_ALLOWED' });
  });

  it("refuses the bot's owner a vote, and lets another approver vote", async () => {
    // A request made before the owner was the bot's owner, or named by another path
    const request = await prisma.approvalRequest.create({
      data: {
        issueId,
        approvalGateId: gateId,
        targetColumnId: toColumnId,
        requestedById: botId,
        approverIds: [botOwner.id, colleague.id],
      },
    });
    const byOwner = await authPost(`/api/approval-requests/${request.id}/vote`, botOwner.token, {
      decision: 'APPROVED',
    });
    expect(byOwner.status).toBe(403);
    expect(byOwner.body.error.code).toBe('SELF_APPROVAL_NOT_ALLOWED');
    expect(await prisma.approvalVote.count({ where: { approvalRequestId: request.id } })).toBe(0);

    const byColleague = await authPost(
      `/api/approval-requests/${request.id}/vote`,
      colleague.token,
      { decision: 'APPROVED' },
    );
    expect(byColleague.status).toBeLessThan(300);
  });

  it('lets the owner vote where the gate allows self-approval', async () => {
    await prisma.approvalRequest.deleteMany({ where: { issueId } });
    await prisma.approvalGate.update({ where: { id: gateId }, data: { allowSelfApproval: true } });
    try {
      const request = await prisma.approvalRequest.create({
        data: {
          issueId,
          approvalGateId: gateId,
          targetColumnId: toColumnId,
          requestedById: botId,
          approverIds: [botOwner.id],
        },
      });
      const byOwner = await authPost(`/api/approval-requests/${request.id}/vote`, botOwner.token, {
        decision: 'APPROVED',
      });
      expect(byOwner.status).toBeLessThan(300);
    } finally {
      await prisma.approvalGate.update({
        where: { id: gateId },
        data: { allowSelfApproval: false },
      });
    }
  });
});
