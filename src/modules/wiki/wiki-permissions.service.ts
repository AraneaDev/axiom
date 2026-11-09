import { RestrictionType } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { revokeLiveAccess } from '../../realtime/access-revocation';
import { ERR } from '../../utils/error-messages';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';
import { assertOwnerPresent, lockBots, onPageChanged } from '../service-accounts/bot-guards';

/**
 * Set restrictions on a page for a specific type.
 * Replaces all existing restrictions of that type with the provided user IDs.
 * @param pageId - The page to set restrictions on
 * @param type - The restriction type (VIEW or EDIT)
 * @param userIds - The user IDs to grant access to
 */
export async function setRestrictions(
  pageId: string,
  type: RestrictionType,
  userIds: string[],
): Promise<void> {
  // Verify page exists
  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page) throw new AppError(404, ERR.PAGE_NOT_FOUND);

  // Delete existing restrictions of this type then create new ones. A bot on the list needs an
  // owner who can open the page with the list in place (decision 9): locked first, written, then
  // checked in the same transaction
  await prisma.$transaction(async (tx) => {
    const bots = await lockBots(tx, userIds);
    await tx.pageRestriction.deleteMany({ where: { pageId, type } });
    for (const userId of userIds) {
      await tx.pageRestriction.create({ data: { pageId, type, userId } });
    }
    for (const botId of bots) await assertOwnerPresent(botId, { pageId }, tx);
  });
  // A restriction hides or locks the page for everyone not listed (re-check not awaited)
  void revokeLiveAccess({ pageId });
  // A new view list can leave out the owners of a bot already listed on the page
  await onPageChanged(pageId);
}

/**
 * Get all restrictions for a page.
 * @param pageId - The page to get restrictions for
 * @returns List of page restrictions with user details
 */
export async function getRestrictions(pageId: string) {
  return prisma.pageRestriction.findMany({
    where: { pageId },
    include: {
      user: { select: USER_BASIC_SELECT },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Remove a single restriction by ID.
 * @param restrictionId - The restriction record to remove
 */
export async function removeRestriction(restrictionId: string): Promise<void> {
  const restriction = await prisma.pageRestriction.findUnique({
    where: { id: restrictionId },
  });
  if (!restriction) throw new AppError(404, ERR.RESTRICTION_NOT_FOUND);

  await prisma.pageRestriction.delete({ where: { id: restrictionId } });
  // Removing the last entry lifts the restriction, but removing one of several takes that
  // user's access away (re-check not awaited)
  void revokeLiveAccess({ pageId: restriction.pageId });
  // And from a bot's owner, so the bot comes off the page too
  await onPageChanged(restriction.pageId);
}
