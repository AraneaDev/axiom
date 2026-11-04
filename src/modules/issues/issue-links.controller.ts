import { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { checkProjectAccess } from '../../middleware/requireProjectAccess';
import { asyncHandler } from '../../utils/asyncHandler';
import { ERR } from '../../utils/error-messages';
import { param, paramInt } from '../../utils/params';

import * as svc from './issue-links.service';

export const getLinks = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const issueNumber = paramInt(req, 'issueNumber');
  res.json(await svc.getLinks(projectId, issueNumber));
});

export const addLink = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const issueNumber = paramInt(req, 'issueNumber');
  // The target issue must be one the user can open: a link shows its title
  const targetProjectId = (req.body as { targetProjectId?: unknown })?.targetProjectId;
  if (typeof targetProjectId === 'string' && targetProjectId !== projectId) {
    const access = await checkProjectAccess(req.userId!, targetProjectId);
    if (access === 'not_found') throw new AppError(404, 'Target issue not found');
    if (access === 'forbidden') throw new AppError(403, ERR.ACCESS_DENIED, 'FORBIDDEN');
  }
  const link = await svc.addLink(projectId, issueNumber, req.body);
  res.status(201).json(link);
});

export const deleteLink = asyncHandler(async (req: Request, res: Response) => {
  await svc.deleteLink(param(req, 'linkId'));
  res.status(204).send();
});
