// Where broadcastToRoom hands an event instead of the local sockets, set by the bridge while the
// process is the worker. A module of its own so broadcast.ts and bridge.ts do not import each
// other.
import type { RealtimeEvent } from './events';

type Publish = (room: string, event: RealtimeEvent) => void;

let hook: Publish | null = null;

/**
 * Sets (or clears) the function that carries events out of a process without sockets.
 * @param next The function, or null for a process that broadcasts itself
 */
export function setPublishHook(next: Publish | null): void {
  hook = next;
}

/** The function that carries events out of this process, or null when it has the sockets. */
export const publishHook = (): Publish | null => hook;
