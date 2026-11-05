import { z } from 'zod';

import { projectAction, projectRead, recordInProject } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import { orgsOfApprovalRequest } from '../../actions/org-lookups';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { prisma } from '../../config/database';
import { ERR } from '../../utils/error-messages';

import * as approvalsService from './approvals.service';
import {
  castVoteSchema,
  createApprovalRequestSchema,
  createGateSchema,
  updateGateSchema,
} from './approvals.validation';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });
const nothing = z.void();

const PROJECT = '/api/projects/:projectId';
const GATES = `${PROJECT}/approval-gates`;
const GATE = `${GATES}/:gateId`;
const ISSUE_REQUESTS = '/api/issues/:issueId/approval-requests';
const REQUEST = '/api/approval-requests/:requestId';

// Authorization runs on the ids alone (R10); every input extends its target (R11)
const projectTarget = z.object({ projectId: z.string() });
const gateTarget = projectTarget.extend({ gateId: z.string() });
const issueTarget = z.object({ issueId: z.string() });
const issueColumnTarget = issueTarget.extend({ targetColumnId: z.string() });
const requestTarget = z.object({ requestId: z.string() });

type ProjectInput = z.infer<typeof projectTarget>;
type IssueInput = z.infer<typeof issueTarget>;
type RequestInput = z.infer<typeof requestTarget>;

const read = projectRead<ProjectInput>((input) => input.projectId);
// Approval gates are project settings: team ADMINs, org OWNERs/ADMINs and platform admins only
const settings = projectAction<ProjectInput>('team:manage_members', (input) => input.projectId);

/**
 * The project of an issue, for routes that name only the issue.
 * @param id - The issue
 */
const issueProject = async (id: string) =>
  (await prisma.issue.findUnique({ where: { id }, select: { projectId: true } }))?.projectId;

// Approval requests belong to an issue: the user needs access to its project
const readIssue = recordInProject<IssueInput>(issueProject, ERR.ISSUE_NOT_FOUND, (i) => i.issueId);
// Requesting an approval moves an issue: it needs issue:edit by role, like other writes
const writeIssue = recordInProject<IssueInput>(
  issueProject,
  ERR.ISSUE_NOT_FOUND,
  (i) => i.issueId,
  ['issue:edit'],
);
const ownRequest = recordInProject<RequestInput>(
  async (id) =>
    (
      await prisma.approvalRequest.findUnique({
        where: { id },
        select: { issue: { select: { projectId: true } } },
      })
    )?.issue.projectId,
  'Approval request not found',
  (i) => i.requestId,
);

registerActions([
  defineAction({
    name: 'approvalGate.list',
    area: 'approvals',
    kind: 'read',
    summary: 'List the approval gates of a project: the column moves that need a person to agree',
    target: projectTarget,
    input: projectTarget,
    output: z.array(record),
    rest: { method: 'GET', path: GATES },
    authorize: read,
    handler: async (_ctx, { projectId }) => approvalsService.listGates(projectId),
  }),
  defineAction({
    name: 'approvalGate.create',
    // A gate decides whom an issue needs before it moves, and a new one can be the weaker way
    // into a column that another gate guards (ruling B3)
    destructive: true,
    area: 'approvals',
    kind: 'write',
    summary: 'Add an approval gate between two columns of a project',
    target: projectTarget,
    input: projectTarget.extend(createGateSchema.shape),
    output: record,
    preview: (_ctx, { projectId, fromColumnId, toColumnId, minApprovals, allowSelfApproval }) =>
      previews.approvalGateCreate(
        projectId,
        fromColumnId,
        toColumnId,
        minApprovals,
        allowSelfApproval,
      ),
    rest: { method: 'POST', path: GATES },
    authorize: settings,
    handler: async (_ctx, { projectId, ...data }) => approvalsService.createGate(projectId, data),
  }),
  defineAction({
    name: 'approvalGate.update',
    destructive: true,
    area: 'approvals',
    kind: 'write',
    summary:
      'Change how many approvals a gate needs, whether the requester may approve, or switch it',
    target: gateTarget,
    input: gateTarget.extend(updateGateSchema.shape),
    output: record,
    preview: (_ctx, { projectId, gateId, ...fields }) =>
      previews.approvalGateUpdate(projectId, gateId, fields),
    rest: { method: 'PATCH', path: GATE },
    authorize: settings,
    handler: async (_ctx, { projectId, gateId, ...data }) =>
      approvalsService.updateGate(projectId, gateId, data),
  }),
  defineAction({
    name: 'approvalGate.delete',
    destructive: true,
    area: 'approvals',
    kind: 'write',
    summary: 'Delete an approval gate and cancel its pending requests',
    target: gateTarget,
    input: gateTarget,
    output: nothing,
    preview: (_ctx, { projectId, gateId }) => previews.approvalGateDelete(projectId, gateId),
    rest: { method: 'DELETE', path: GATE },
    authorize: settings,
    handler: async (_ctx, { projectId, gateId }) => approvalsService.deleteGate(projectId, gateId),
  }),
  defineAction({
    name: 'approvalRequest.listPending',
    // The route is not under approval-gates, so tokens reach it with the issue scopes
    area: 'issues',
    kind: 'read',
    summary: 'List the approval requests of a project that still wait for votes',
    target: projectTarget,
    input: projectTarget,
    output: z.array(record),
    rest: { method: 'GET', path: `${PROJECT}/approval-requests/pending` },
    authorize: read,
    handler: async (_ctx, { projectId }) => approvalsService.listPendingForProject(projectId),
  }),
  defineAction({
    name: 'approvalRequest.listMine',
    // Under /api/users/me, so a token that reads issues or wiki reaches it, as it always did
    area: 'issues',
    kind: 'read',
    openToReadOf: ['issues', 'wiki'],
    summary: 'List the approval requests on your teams that still wait for your vote',
    input: z.object({}),
    output: z.array(record),
    rest: { method: 'GET', path: '/api/users/me/pending-approvals' },
    // Only requests on the teams of the caller come back
    authorize: async () => {},
    handler: async (ctx) => approvalsService.getPendingApprovalsForUser(ctx.userId),
  }),
  defineAction({
    name: 'approvalRequest.listForIssue',
    area: 'issues',
    kind: 'read',
    summary: 'List the approval requests of an issue, newest first, with their votes',
    target: issueTarget,
    input: issueTarget,
    output: z.array(record),
    rest: { method: 'GET', path: ISSUE_REQUESTS },
    authorize: readIssue,
    handler: async (_ctx, { issueId }) => approvalsService.getRequestsForIssue(issueId),
  }),
  defineAction({
    name: 'approvalRequest.create',
    area: 'issues',
    kind: 'write',
    summary: 'Ask people to approve moving an issue into a column that a gate guards',
    target: issueColumnTarget,
    input: issueColumnTarget.extend(createApprovalRequestSchema.shape),
    output: record,
    rest: { method: 'POST', path: `${ISSUE_REQUESTS}/:targetColumnId` },
    authorize: writeIssue,
    handler: async (ctx, { issueId, targetColumnId, approverIds }) =>
      approvalsService.createApprovalRequestWithTarget(
        issueId,
        targetColumnId,
        ctx.userId,
        approverIds,
      ),
  }),
  defineAction({
    name: 'approvalRequest.vote',
    // A vote decides the request, and an approval moves the issue past a human check (A21)
    destructive: true,
    orgIds: (_ctx, { requestId }) => orgsOfApprovalRequest(requestId),
    area: 'approvals',
    kind: 'write',
    summary:
      'Approve or reject an approval request you were asked to decide. A rejection ends it; ' +
      'enough approvals move the issue',
    target: requestTarget,
    input: requestTarget.extend(castVoteSchema.shape),
    output: record,
    preview: (_ctx, { requestId, decision }) => previews.approvalRequestVote(requestId, decision),
    rest: { method: 'POST', path: `${REQUEST}/vote` },
    authorize: ownRequest,
    handler: async (ctx, { requestId, ...data }) =>
      approvalsService.castVote(requestId, ctx.userId, data),
  }),
  defineAction({
    name: 'approvalRequest.cancel',
    orgIds: (_ctx, { requestId }) => orgsOfApprovalRequest(requestId),
    area: 'approvals',
    kind: 'write',
    summary: 'Cancel an approval request you made while it still waits',
    target: requestTarget,
    input: requestTarget,
    output: nothing,
    rest: { method: 'POST', path: `${REQUEST}/cancel`, status: 204, emptyBody: true },
    authorize: ownRequest,
    handler: async (ctx, { requestId }) => approvalsService.cancelRequest(requestId, ctx.userId),
  }),
]);
