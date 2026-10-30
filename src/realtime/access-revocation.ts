/**
 * Live connections check access when they join. When access is taken away (a member
 * removed or demoted, a space permission or page restriction changed), the code that changed
 * it calls `revokeLiveAccess`, and each realtime layer re-checks what open connections hold.
 *
 * Like room-registry, this module imports nothing at runtime: services call it without
 * importing the WebSocket servers, which register their hooks at load.
 */

/**
 * What a change can affect: one user's access (removed, demoted), one space's (its
 * permissions changed) or one page's (its restrictions changed). Each layer re-checks only
 * the connections that match.
 */
export type RevocationScope = { userId: string } | { spaceId: string } | { pageId: string };

type AccessRevokedHook = (scope: RevocationScope) => Promise<void>;

const hooks: AccessRevokedHook[] = [];

/**
 * Register a re-check to run when access is taken away.
 * @param fn - Re-checks matching live connections; treats a failed check as lost access
 */
export function registerAccessRevokedHook(fn: AccessRevokedHook): void {
  if (!hooks.includes(fn)) hooks.push(fn);
}

/**
 * Re-check the live connections a change can affect, dropping what they may no longer see.
 * Callers don't await it: the change is already committed, and the re-check must not hold
 * up (or fail) the request. The returned promise settles when every layer has finished.
 * @param scope - The user, space or page whose access changed
 */
export function revokeLiveAccess(scope: RevocationScope): Promise<void> {
  return Promise.all(hooks.map((fn) => fn(scope).catch(() => undefined))).then(() => undefined);
}

type DisconnectHook = (userId: string) => void;

const disconnectHooks: DisconnectHook[] = [];

/**
 * Register how a realtime layer closes every connection of a user.
 * @param fn - Closes the user's sockets; must not throw
 */
export function registerDisconnectHook(fn: DisconnectHook): void {
  if (!disconnectHooks.includes(fn)) disconnectHooks.push(fn);
}

/**
 * Close every live connection of a user (deactivated or deleted). The sockets authenticated
 * with a token that stays valid until it expires, so they must be closed, not re-checked.
 * @param userId - The user to disconnect
 */
export function disconnectUser(userId: string): void {
  for (const fn of disconnectHooks) {
    try {
      fn(userId);
    } catch {
      // A layer that fails to close must not stop the others
    }
  }
}
