import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import * as svc from './issue-links.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function getLinks(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');
    const issueNumber = param(req, 'issueNumber');
    res.json(await svc.getLinks(projectId, parseInt(issueNumber, 10)));
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function addLink(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');
    const issueNumber = param(req, 'issueNumber');
    const link = await svc.addLink(projectId, parseInt(issueNumber), req.body);
    res.status(201).json(link);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function deleteLink(req: Request, res: Response, next: NextFunction) {
  try {
    await svc.deleteLink(param(req, 'linkId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
