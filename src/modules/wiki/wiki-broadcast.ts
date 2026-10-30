import { prisma } from '../../config/database';
import { broadcastToRoom } from '../../realtime/broadcast';

/**
 * Tell a space's realtime room that a page changed. Every member of the space receives it,
 * including members a VIEW restriction hides the page from, so a restricted page's event
 * leaves out its id: members still learn the space changed (clients only use spaceId, to
 * refetch the tree), but not which hidden page it was.
 * @param spaceId - The page's space
 * @param pageId - The page that changed
 * @param restricted - Whether the page is VIEW-restricted; looked up when omitted. Pass it
 * when the page is already deleted and its restrictions are gone with it.
 */
export async function broadcastWikiUpdated(
  spaceId: string,
  pageId: string,
  restricted?: boolean,
): Promise<void> {
  const hidden = restricted ?? (await isViewRestricted(pageId));
  broadcastToRoom(
    `space:${spaceId}`,
    hidden ? { type: 'wiki:updated', spaceId } : { type: 'wiki:updated', spaceId, pageId },
  );
}

/**
 * Whether a page is VIEW-restricted, for callers that must decide before deleting it.
 * @param pageId
 */
export async function isViewRestricted(pageId: string): Promise<boolean> {
  return (await prisma.pageRestriction.count({ where: { pageId, type: 'VIEW' } })) > 0;
}
