import { prisma } from '../../config/database';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';

import { hiddenPageIds } from './wiki-permissions.service';

/**
 * List all labels for a wiki page.
 * @param pageId - The page to list labels for
 * @returns Array of page label records
 */
export async function listPageLabels(pageId: string) {
  return prisma.pageLabel.findMany({
    where: { pageId },
    orderBy: { label: 'asc' },
  });
}

/**
 * Add a label to a wiki page.
 * @param pageId - The page to add the label to
 * @param label - The label text
 * @returns The created page label record
 * @throws {AppError} 404 if page not found
 */
export async function addLabel(pageId: string, label: string) {
  await findOrThrow(prisma.page.findUnique({ where: { id: pageId } }), ERR.PAGE_NOT_FOUND);

  return prisma.pageLabel.create({
    data: { pageId, label },
  });
}

/**
 * Remove a label from a wiki page.
 * @param pageId - The page to remove the label from
 * @param label - The label text to remove
 * @throws {AppError} 404 if label not found on the page
 */
export async function removeLabel(pageId: string, label: string) {
  const existing = await findOrThrow(
    prisma.pageLabel.findUnique({
      where: { pageId_label: { pageId, label } },
    }),
    'Label not found on this page',
  );
  await prisma.pageLabel.delete({ where: { id: existing.id } });
}

/**
 * List all labels on a wiki page.
 * @param pageId - The page to list labels for
 * @returns List of page label records ordered alphabetically
 */
export async function listLabels(pageId: string) {
  return prisma.pageLabel.findMany({
    where: { pageId },
    orderBy: { label: 'asc' },
  });
}

/**
 * Search for pages in a wiki space by label.
 * @param spaceId - The wiki space to search in
 * @param label - The label to filter pages by
 * @param userId - The searcher
 * @returns List of matching pages with id, title, and slug
 */
export async function searchPagesByLabel(spaceId: string, label: string, userId: string) {
  const pages = await prisma.page.findMany({
    where: {
      spaceId,
      pageLabels: { some: { label } },
    },
    select: { id: true, title: true, slug: true },
    orderBy: { title: 'asc' },
  });
  // Leave out pages a VIEW restriction hides from this user
  const hidden = await hiddenPageIds(userId, spaceId);
  return pages.filter((p) => !hidden.has(p.id));
}
