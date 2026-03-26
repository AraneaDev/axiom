import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as svc from './issue-links.service';

export const getLinks = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const issueNumber = param(req, 'issueNumber');
  res.json(await svc.getLinks(projectId, parseInt(issueNumber, 10)));
});

export const addLink = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const issueNumber = param(req, 'issueNumber');
  const link = await svc.addLink(projectId, parseInt(issueNumber), req.body);
  res.status(201).json(link);
});

export const deleteLink = asyncHandler(async (req: Request, res: Response) => {
  await svc.deleteLink(param(req, 'linkId'));
  res.status(204).send();
});
