// Carries realtime events from a process without sockets (the worker) to the process that has
// them (the API). The API broadcasts directly when it is the producer; the worker publishes on a
// Redis channel and every API process subscribed to it broadcasts. A process either broadcasts
// or publishes, never both, so no browser hears an event twice.
import { redis } from '../config/redis';
import { logger } from '../utils/logger';

import { broadcastToRoom } from './broadcast';
import type { RealtimeEvent } from './events';

export const REALTIME_CHANNEL = 'axiom:realtime';

type Delivery = (room: string, event: RealtimeEvent) => void;

let mode: 'local' | 'redis' = 'local';

/**
 * Chooses how this process delivers realtime events: `local` (the default, the API) broadcasts to
 * its own sockets, `redis` (the worker) publishes for the API processes to broadcast.
 * @param next The mode
 */
export function setRealtimeMode(next: 'local' | 'redis'): void {
  mode = next;
}

/**
 * Sends an event to the browsers in a room, from whichever process produced it.
 * @param room The room, such as `project:<id>`
 * @param event The event
 */
export function publishRealtime(room: string, event: RealtimeEvent): void {
  if (mode === 'local') {
    broadcastToRoom(room, event);
    return;
  }
  redis.publish(REALTIME_CHANNEL, JSON.stringify({ room, event })).catch((err: unknown) => {
    logger.warn('realtime publish failed', {
      error: err instanceof Error ? err.message : 'unknown',
    });
  });
}

function parse(message: string): { room: string; event: RealtimeEvent } | null {
  try {
    const value = JSON.parse(message) as { room?: unknown; event?: { type?: unknown } };
    if (typeof value.room !== 'string' || !value.room) return null;
    if (!value.event || typeof value.event.type !== 'string') return null;
    return { room: value.room, event: value.event as RealtimeEvent };
  } catch {
    return null;
  }
}

/**
 * Subscribes to the channel the worker publishes on and delivers each event to the sockets of
 * this process. Run in the API only.
 * @param deliver Where an event goes (the broadcast to local sockets by default)
 * @returns A function that unsubscribes and closes the connection
 */
export async function startRealtimeSubscriber(
  deliver: Delivery = broadcastToRoom,
): Promise<() => Promise<void>> {
  const subscriber = redis.duplicate();
  subscriber.on('error', () => {
    // The shared client already logs connection trouble
  });
  subscriber.on('message', (_channel, message) => {
    const parsed = parse(message);
    if (parsed) deliver(parsed.room, parsed.event);
  });
  await subscriber.connect();
  await subscriber.subscribe(REALTIME_CHANNEL);
  return async () => {
    subscriber.disconnect();
  };
}
