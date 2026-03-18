import { Request, Response } from 'express';

import { param } from '../../utils/params';

import * as svc from './issue-links.service';

/**
 *
 * @param req
 * @param res
 */
export async function getLinks(req: Request, res: Response) {
  const projectId = param(req, 'projectId');
  const issueNumber = param(req, 'issueNumber');
  res.json(await svc.getLinks(projectId, parseInt(issueNumber)));
}

/**
 *
 * @param req
 * @param res
 */
export async function addLink(req: Request, res: Response) {
  const projectId = param(req, 'projectId');
  const issueNumber = param(req, 'issueNumber');
  const link = await svc.addLink(projectId, parseInt(issueNumber), req.body);
  res.status(201).json(link);
}

/**
 *
 * @param req
 * @param res
 */
export async function deleteLink(req: Request, res: Response) {
  await svc.deleteLink(param(req, 'linkId'));
  res.status(204).send();
}
