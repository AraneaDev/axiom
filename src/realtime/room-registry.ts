/**
 * What the page write path needs to know about live collaboration rooms, without importing the
 * collaboration server: whether a page has a live room, and who to tell about an external change.
 *
 * The collaboration server registers both at load. Keeping them here breaks the import cycle
 * page-writes -> collaboration -> page-writes (and the one through broadcast and ws-server):
 * this module imports nothing at runtime.
 */

import type { PendingPageChange } from '@prisma/client';

type RoomLiveCheck = (pageId: string) => boolean;
type ExternalChangeHook = (pageId: string, pending: PendingPageChange) => void;

let roomLiveCheck: RoomLiveCheck = () => false;
const externalChangeHooks: ExternalChangeHook[] = [];

/**
 * Set how to tell whether a page has a live room. The collaboration server registers its room map.
 * @param check - Returns true when a room is live for the page
 */
export function setRoomLiveCheck(check: RoomLiveCheck): void {
  roomLiveCheck = check;
}

/**
 * Whether a collaboration room is live for the page. False until the collaboration server loaded.
 * @param pageId
 */
export function isRoomLive(pageId: string): boolean {
  return roomLiveCheck(pageId);
}

/**
 * Register a listener that is told when an external change is recorded for a page with a live
 * collaboration room. The collaboration layer registers here to notify the room.
 * @param fn - Called after the pending change is committed
 */
export function registerExternalChangeHook(fn: ExternalChangeHook): void {
  if (!externalChangeHooks.includes(fn)) externalChangeHooks.push(fn);
}

/**
 * Tell every registered listener about a recorded external change.
 * @param pageId
 * @param pending - The committed pending change
 */
export function emitExternalChange(pageId: string, pending: PendingPageChange): void {
  for (const hook of externalChangeHooks) hook(pageId, pending);
}

/** Test-only: forget every registered hook. */
export function resetExternalChangeHooksForTest(): void {
  externalChangeHooks.length = 0;
}
