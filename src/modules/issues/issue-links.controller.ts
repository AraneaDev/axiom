import { Request, Response } from 'express';

import * as svc from './issue-links.service';

/**
 *
 * @param req
 * @param res
 */
export async function getLinks(req: Request, res: Response) {
  const { projectId, issueNumber } = req.params;
  res.json(await svc.getLinks(projectId, parseInt(issueNumber)));
}

/**
 *
 * @param req
 * @param res
 */
export async function addLink(req: Request, res: Response) {
  const { projectId, issueNumber } = req.params;
  const link = await svc.addLink(projectId, parseInt(issueNumber), req.body);
  res.status(201).json(link);
}

/**
 *
 * @param req
 * @param res
 */
export async function deleteLink(req: Request, res: Response) {
  await svc.deleteLink(req.params.linkId);
  res.status(204).send();
}
