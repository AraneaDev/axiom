import { Request, Response } from 'express';
import * as svc from './issue-commits.service';

export async function getCommits(req: Request, res: Response) {
  const { projectId, issueNumber } = req.params;
  res.json(await svc.getCommits(projectId, parseInt(issueNumber)));
}
