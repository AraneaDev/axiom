import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate } from '../../utils/validation';

import * as approvalsService from './approvals.service';
import {
  createGateSchema,
  updateGateSchema,
  createApprovalRequestSchema,
  castVoteSchema,
} from './approvals.validation';

// ─── Gate CRUD ───────────────────────────────────────────────────────────────

export const listGates = asyncHandler(async (req: Request, res: Response) => {
  const gates = await approvalsService.listGates(param(req, 'projectId'));
  res.json(gates);
});

export const createGate = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createGateSchema, req.body);
  const gate = await approvalsService.createGate(param(req, 'projectId'), data);
  res.status(201).json(gate);
});

export const updateGate = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updateGateSchema, req.body);
  const gate = await approvalsService.updateGate(
    param(req, 'projectId'),
    param(req, 'gateId'),
    data,
  );
  res.json(gate);
});

export const deleteGate = asyncHandler(async (req: Request, res: Response) => {
  await approvalsService.deleteGate(param(req, 'projectId'), param(req, 'gateId'));
  res.status(204).send();
});

// ─── Approval Requests ───────────────────────────────────────────────────────

export const createRequest = asyncHandler(async (req: Request, res: Response) => {
  const { approverIds } = validate(createApprovalRequestSchema, req.body);
  const request = await approvalsService.createApprovalRequestWithTarget(
    param(req, 'issueId'),
    param(req, 'targetColumnId'),
    req.userId!,
    approverIds,
  );
  res.status(201).json(request);
});

export const listRequestsForIssue = asyncHandler(async (req: Request, res: Response) => {
  const requests = await approvalsService.getRequestsForIssue(param(req, 'issueId'));
  res.json(requests);
});

export const listPendingForProject = asyncHandler(async (req: Request, res: Response) => {
  const requests = await approvalsService.listPendingForProject(param(req, 'projectId'));
  res.json(requests);
});

// ─── Voting ──────────────────────────────────────────────────────────────────

export const vote = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(castVoteSchema, req.body);
  const voteResult = await approvalsService.castVote(param(req, 'requestId'), req.userId!, data);
  res.status(201).json(voteResult);
});

export const cancelRequest = asyncHandler(async (req: Request, res: Response) => {
  await approvalsService.cancelRequest(param(req, 'requestId'), req.userId!);
  res.status(204).send();
});

// ─── My Approvals ─────────────────────────────────────────────────────────────

export const myPendingApprovals = asyncHandler(async (req: Request, res: Response) => {
  const approvals = await approvalsService.getPendingApprovalsForUser(req.userId!);
  res.json(approvals);
});
