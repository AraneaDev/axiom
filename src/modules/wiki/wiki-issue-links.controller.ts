import type { Request, Response } from 'express';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { checkProjectAccess } from '../../middleware/requireProjectAccess';
import { ERR } from '../../utils/error-messages';
import { param } from '../../utils/params';

import * as linkService from './wiki-issue-links.service';

/**
 *
 * @param req
 * @param res
 */
export async function listLinkedIssues(req: Request, res: Response) {
  const pageId = param(req, 'pageId');
  const links = await linkService.getLinksForPage(pageId, req.userId!);
  res.json(links);
}

/**
 *
 * @param req
 * @param res
 */
export async function listLinkedPages(req: Request, res: Response) {
  const issueId = param(req, 'issueId');
  const links = await linkService.getLinksForIssue(issueId, req.userId!);
  res.json(links);
}

/**
 *
 * @param req
 * @param res
 */
export async function addLink(req: Request, res: Response) {
  const pageId = param(req, 'pageId');
  const { issueId, linkType } = req.body as { issueId?: unknown; linkType?: unknown };
  if (typeof issueId !== 'string' || (linkType !== 'EMBED' && linkType !== 'MENTION')) {
    throw new AppError(400, 'issueId and a linkType of EMBED or MENTION are required');
  }
  // The issue must be one the user can open: the link shows its details on the page
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { projectId: true },
  });
  if (!issue) throw new AppError(404, ERR.ISSUE_NOT_FOUND);
  if ((await checkProjectAccess(req.userId!, issue.projectId)) !== 'ok') {
    throw new AppError(403, ERR.ACCESS_DENIED, 'FORBIDDEN');
  }
  const link = await linkService.addLink(
    pageId,
    issueId,
    linkType as 'EMBED' | 'MENTION',
    req.userId!,
  );
  res.status(201).json(link);
}

/**
 *
 * @param req
 * @param res
 */
export async function removeLink(req: Request, res: Response) {
  const pageId = param(req, 'pageId');
  const issueId = param(req, 'issueId');
  await linkService.removeEmbedLink(pageId, issueId);
  res.status(204).end();
}
