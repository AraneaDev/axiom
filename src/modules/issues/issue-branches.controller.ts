import { Request, Response } from 'express';

import { param } from '../../utils/params';

import * as svc from './issue-branches.service';

/**
 *
 * @param req
 * @param res
 */
export async function getBranches(req: Request, res: Response) {
  const projectId = param(req, 'projectId');
  const issueNumber = param(req, 'issueNumber');
  res.json(await svc.getBranches(projectId, parseInt(issueNumber)));
}

/**
 *
 * @param req
 * @param res
 */
export async function createBranch(req: Request, res: Response) {
  const projectId = param(req, 'projectId');
  const issueNumber = param(req, 'issueNumber');
  const branch = await svc.createBranch(projectId, parseInt(issueNumber), req.userId!, req.body);
  res.status(201).json(branch);
}

/**
 *
 * @param req
 * @param res
 */
export async function getSuggestedName(req: Request, res: Response) {
  const projectId = param(req, 'projectId');
  const issueNumber = param(req, 'issueNumber');
  const suggestion = await svc.getSuggestedName(projectId, parseInt(issueNumber));
  res.json({ suggestion });
}
