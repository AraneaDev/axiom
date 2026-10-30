/**
 * Live connections check access when they join, not afterwards. When a user loses access
 * (removed from an org or a team), the code that removed it calls `revokeLiveAccess`, and
 * each realtime layer re-checks what that user's open connections hold.
 *
 * Like room-registry, this module imports nothing at runtime: services call it without
 * importing the WebSocket servers, which register their hooks at load.
 */

type AccessRevokedHook = (userId: string) => Promise<void>;

const hooks: AccessRevokedHook[] = [];

/**
 * Register a re-check to run when a user loses access.
 * @param fn - Re-checks the user's live connections; must not throw
 */
export function registerAccessRevokedHook(fn: AccessRevokedHook): void {
  if (!hooks.includes(fn)) hooks.push(fn);
}

/**
 * Re-check every live connection of a user against the current permissions, dropping what
 * they may no longer see. Resolves once every layer has finished.
 * @param userId - The user who lost access
 */
export async function revokeLiveAccess(userId: string): Promise<void> {
  await Promise.all(hooks.map((fn) => fn(userId).catch(() => undefined)));
}
