import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { assertPageAccess, checkWikiSpaceOrgAccess } from '../../middleware/rbac';
import { ERR } from '../../utils/error-messages';

import { canAccessSpace } from './space-permissions.service';

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
  // Pages never leave their org, even for someone who belongs to both
  if (spaceId !== sourceSpaceId) {
    const [source, target] = await Promise.all(
      [sourceSpaceId, spaceId].map((id) =>
        prisma.wikiSpace.findUnique({
          where: { id },
          select: { team: { select: { orgId: true } } },
        }),
      ),
    );
    if (!target) throw new AppError(404, ERR.SPACE_NOT_FOUND);
    if (source?.team.orgId !== target.team.orgId) {
      throw new AppError(403, 'Pages can only move to spaces in the same organization');
    }
  }
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

/**
 * assertDestinationWritable for a page that is addressed by id: its own space is the source.
 * @param userId
 * @param pageId - The page being moved, copied or reordered
 * @param targetSpaceId - Where it goes; the page's own space when omitted
 * @param parentId - The new parent, when there is one
 * @throws {AppError} 404 when the page does not exist
 */
export async function assertPageDestinationWritable(
  userId: string,
  pageId: string,
  targetSpaceId: string | undefined,
  parentId: string | null | undefined,
): Promise<void> {
  await assertDestinationWritable(userId, await sourceSpaceId(pageId), targetSpaceId, parentId);
}
