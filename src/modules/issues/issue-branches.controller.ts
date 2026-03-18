import { Request, Response } from 'express';

import * as svc from './issue-branches.service';

/**
 *
 * @param req
 * @param res
 */
export async function getBranches(req: Request, res: Response) {
  const { projectId, issueNumber } = req.params;
  res.json(await svc.getBranches(projectId, parseInt(issueNumber)));
}

/**
 *
 * @param req
 * @param res
 */
export async function createBranch(req: Request, res: Response) {
  const { projectId, issueNumber } = req.params;
  const branch = await svc.createBranch(projectId, parseInt(issueNumber), req.userId!, req.body);
  res.status(201).json(branch);
}

/**
 *
 * @param req
 * @param res
 */
export async function getSuggestedName(req: Request, res: Response) {
  const { projectId, issueNumber } = req.params;
  const suggestion = await svc.getSuggestedName(projectId, parseInt(issueNumber));
  res.json({ suggestion });
}
