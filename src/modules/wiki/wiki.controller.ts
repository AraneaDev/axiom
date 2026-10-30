import { Request, Response } from 'express';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { assertPageAccess, checkWikiSpaceOrgAccess } from '../../middleware/rbac';
import { asyncHandler } from '../../utils/asyncHandler';
import { ERR } from '../../utils/error-messages';
import { param } from '../../utils/params';
import {
  validate,
  createWikiSpaceSchema,
  createPageSchema,
  updatePageSchema,
  flushPageSessionSchema,
  movePageSchema,
  reorderPageSchema,
  copyPageSchema,
  restoreVersionSchema,
  applyMergeSchema,
} from '../../utils/validation';

import { canAccessSpace } from './space-permissions.service';
import * as wikiExportService from './wiki-export.service';
import { hiddenPageIds, pruneHiddenPages } from './wiki-permissions.service';
import * as wikiService from './wiki.service';

export const createSpace = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createWikiSpaceSchema, req.body);
  const space = await wikiService.createSpace(param(req, 'teamId'), data);
  res.status(201).json(space);
});

export const getSpace = asyncHandler(async (req: Request, res: Response) => {
  const space = await wikiService.getSpace(param(req, 'spaceId'), req.userId!);
  res.json(space);
});

export const listSpaces = asyncHandler(async (req: Request, res: Response) => {
  const includeArchived = req.query.includeArchived === 'true';
  const spaces = await wikiService.listSpaces(param(req, 'teamId'), includeArchived);
  res.json(spaces);
});

export const updateSpace = asyncHandler(async (req: Request, res: Response) => {
  const space = await wikiService.updateSpace(param(req, 'spaceId'), req.body);
  res.json(space);
});

export const createPage = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createPageSchema, req.body);
  const page = await wikiService.createPage(param(req, 'spaceId'), req.userId!, data);
  res.status(201).json(page);
});

export const getPage = asyncHandler(async (req: Request, res: Response) => {
  const page = await wikiService.getPage(param(req, 'spaceId'), param(req, 'pageSlug'), req.userId);
  res.json(page);
});

export const updatePage = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updatePageSchema, req.body);
  const page = await wikiService.updatePage(
    param(req, 'spaceId'),
    param(req, 'pageSlug'),
    req.userId!,
    data,
  );
  res.json(page);
});

export const flushPageSession = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(flushPageSessionSchema, req.body ?? {});
  const result = await wikiService.flushPageSession(
    param(req, 'spaceId'),
    param(req, 'pageSlug'),
    req.userId!,
    data.changeDescription?.trim() || undefined,
  );
  res.json(result);
});

export const getPendingMerge = asyncHandler(async (req: Request, res: Response) => {
  const merge = await wikiService.getPagePendingMerge(
    param(req, 'spaceId'),
    param(req, 'pageSlug'),
    req.userId!,
  );
  res.json(merge);
});

export const applyMerge = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(applyMergeSchema, req.body);
  await wikiService.applyPageMerge(
    param(req, 'spaceId'),
    param(req, 'pageSlug'),
    req.userId!,
    data,
  );
  res.status(204).send();
});

export const deletePage = asyncHandler(async (req: Request, res: Response) => {
  await wikiService.deletePage(param(req, 'spaceId'), param(req, 'pageSlug'), req.userId);
  res.status(204).send();
});

export const pageHistory = asyncHandler(async (req: Request, res: Response) => {
  const versions = await wikiService.getPageHistory(param(req, 'spaceId'), param(req, 'pageSlug'));
  res.json(versions);
});

export const exportPage = asyncHandler(async (req: Request, res: Response) => {
  const format = (req.query.format as string) || 'html';
  await wikiExportService.exportPage(param(req, 'spaceId'), param(req, 'pageSlug'), format, res);
});

export const pageTree = asyncHandler(async (req: Request, res: Response) => {
  const spaceId = param(req, 'spaceId');
  // The tree is cached per space: hide restricted pages per user after the cache
  const tree = pruneHiddenPages(
    await wikiService.getPageTree(spaceId),
    await hiddenPageIds(req.userId!, spaceId),
  );
  res.json(tree);
});

// Version Comparison & Restore

export const diffVersions = asyncHandler(async (req: Request, res: Response) => {
  const from = parseInt(req.query.from as string, 10);
  const to = parseInt(req.query.to as string, 10);
  if (isNaN(from) || isNaN(to)) {
    res
      .status(400)
      .json({ error: { message: 'Both "from" and "to" query params are required as integers' } });
    return;
  }
  const result = await wikiService.diffVersions(
    param(req, 'spaceId'),
    param(req, 'pageSlug'),
    from,
    to,
  );
  res.json(result);
});

export const restoreVersion = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(restoreVersionSchema, req.body);
  const page = await wikiService.restoreVersion(
    param(req, 'spaceId'),
    param(req, 'pageSlug'),
    data.version,
    req.userId!,
  );
  res.json(page);
});

// Page Move / Copy

/**
 * Where a page lands must be writable too: the route only checked the source page. The
 * destination space needs org membership and EDIT access, and a new parent must be a page
 * in that space the user may edit.
 * @param userId
 * @param sourceSpaceId - Used when no target space is given
 * @param targetSpaceId
 * @param parentId
 */
async function assertDestinationWritable(
  userId: string,
  sourceSpaceId: string,
  targetSpaceId: string | undefined,
  parentId: string | null | undefined,
): Promise<void> {
  const spaceId = targetSpaceId ?? sourceSpaceId;
  const orgAccess = await checkWikiSpaceOrgAccess(spaceId, userId);
  if (orgAccess === 'not_found') throw new AppError(404, ERR.SPACE_NOT_FOUND);
  if (orgAccess === 'forbidden' || !(await canAccessSpace(spaceId, userId, 'EDIT'))) {
    throw new AppError(403, 'You do not have access to the target space');
  }
  if (parentId) {
    const parent = await prisma.page.findUnique({
      where: { id: parentId },
      select: { spaceId: true },
    });
    if (!parent || parent.spaceId !== spaceId) {
      throw new AppError(400, 'The parent page must be in the target space');
    }
    await assertPageAccess(userId, parentId, 'edit');
  }
}

async function sourceSpaceId(pageId: string): Promise<string> {
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { spaceId: true } });
  if (!page) throw new AppError(404, ERR.PAGE_NOT_FOUND);
  return page.spaceId;
}

export const movePage = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(movePageSchema, req.body);
  const pageId = param(req, 'pageId');
  await assertDestinationWritable(
    req.userId!,
    await sourceSpaceId(pageId),
    data.targetSpaceId,
    data.targetParentId,
  );
  const page = await wikiService.movePage(pageId, data.targetSpaceId, data.targetParentId);
  res.json(page);
});

export const copyPage = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(copyPageSchema, req.body);
  const pageId = param(req, 'pageId');
  await assertDestinationWritable(
    req.userId!,
    await sourceSpaceId(pageId),
    data.targetSpaceId,
    undefined,
  );
  const page = await wikiService.copyPage(pageId, req.userId!, data.targetSpaceId, data.newSlug);
  res.status(201).json(page);
});

export const reorderPage = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(reorderPageSchema, req.body);
  const pageId = param(req, 'pageId');
  await assertDestinationWritable(
    req.userId!,
    await sourceSpaceId(pageId),
    undefined,
    data.parentId,
  );
  const result = await wikiService.reorderPage(pageId, data.parentId, data.position);
  res.json(result);
});
