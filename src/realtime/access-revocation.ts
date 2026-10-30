/**
 * Live connections check access when they join. When access is taken away (a member
 * removed or demoted, a space permission or page restriction changed), the code that changed
 * it calls `revokeLiveAccess`, and each realtime layer re-checks what open connections hold.
 *
 * Like room-registry, this module imports nothing at runtime: services call it without
 * importing the WebSocket servers, which register their hooks at load.
 */

/** Called with the user who lost access, or null when a change may affect anyone */
type AccessRevokedHook = (userId: string | null) => Promise<void>;

const hooks: AccessRevokedHook[] = [];

/**
 * Register a re-check to run when a user loses access.
 * @param fn - Re-checks the user's live connections; must not throw
 */
export function registerAccessRevokedHook(fn: AccessRevokedHook): void {
  if (!hooks.includes(fn)) hooks.push(fn);
}

/**
 * Re-check live connections against the current permissions, dropping what they may no
 * longer see. Resolves once every layer has finished.
 * @param userId - The user who lost access; omit when a change may affect any user (a space
 * permission or page restriction changed)
 */
export async function revokeLiveAccess(userId: string | null = null): Promise<void> {
  await Promise.all(hooks.map((fn) => fn(userId).catch(() => undefined)));
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
