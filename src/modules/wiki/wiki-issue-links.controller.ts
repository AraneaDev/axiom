import type { Request, Response } from 'express';

import { prisma } from '../../config/database';
import { param } from '../../utils/params';

import * as linkService from './wiki-issue-links.service';

/**
 *
 * @param req
 * @param res
 */
export async function listLinkedIssues(req: Request, res: Response) {
  const pageId = param(req, 'pageId');
  const links = await linkService.getLinksForPage(pageId);
  res.json(links);
}

/**
 *
 * @param req
 * @param res
 */
export async function listLinkedPages(req: Request, res: Response) {
  const issueId = param(req, 'issueId');
  const links = await linkService.getLinksForIssue(issueId);
  res.json(links);
}

/**
 *
 * @param req
 * @param res
 */
export async function addLink(req: Request, res: Response) {
  const pageId = param(req, 'pageId');
  const { issueId, linkType } = req.body;
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

/**
 *
 * @param req
 * @param res
 */
export async function listLinkedPagesForIssue(req: Request, res: Response) {
  const projectId = param(req, 'projectId');
  const issueNumber = param(req, 'issueNumber');
  const issue = await prisma.issue.findFirst({
    where: { projectId, number: parseInt(issueNumber, 10) },
    select: { id: true },
  });
  if (!issue) {
    res.status(404).json({ error: { message: 'Issue not found' } });
    return;
  }
  const links = await linkService.getLinksForIssue(issue.id);
  res.json(links);
}
