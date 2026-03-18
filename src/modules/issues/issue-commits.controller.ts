import { Request, Response } from 'express';

import { param } from '../../utils/params';

import * as svc from './issue-commits.service';

/**
 *
 * @param req
 * @param res
 */
export async function getCommits(req: Request, res: Response) {
  const projectId = param(req, 'projectId');
  const issueNumber = param(req, 'issueNumber');
  res.json(await svc.getCommits(projectId, parseInt(issueNumber)));
}
