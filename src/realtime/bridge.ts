// Carries realtime events from a process without sockets (the worker) to the process that has
// them (the API). The API broadcasts directly when it is the producer; the worker publishes on a
// Redis channel and every API process subscribed to it broadcasts. A process either broadcasts
// or publishes, never both, so no browser hears an event twice.
//
// Both ends keep their own connection that never gives up: Redis restarting for a minute must
// not silence realtime until the next deploy. While the publisher is disconnected an event is
// dropped (a stale one is worth less than a flooded queue), and the subscriber misses what is
// published meanwhile; the browsers refetch on their next visit anyway.
import { randomUUID } from 'node:crypto';

import Redis from 'ioredis';
import { z } from 'zod';

import { REDIS_URL } from '../config/redis';
import { logger } from '../utils/logger';

import { broadcastLocal, broadcastToRoom } from './broadcast';
import type { RealtimeEvent } from './events';
import { setPublishHook } from './publish-hook';

export const REALTIME_CHANNEL = 'axiom:realtime';

// What may cross the bridge: the project rooms and the events the worker produces. Anything else
// is dropped, whoever sent it.
const message = z
  .object({
    room: z.string().regex(/^project:c[a-z0-9]{20,31}$/),
    event: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('issue:development-updated'),
        projectId: z.string().min(1),
        issueIds: z.array(z.string().min(1)).max(1000),
      }),
      // The worker's backfill of GitHub Issues moved on
      z.object({
        type: z.literal('github:import-progress'),
        projectId: z.string().min(1),
        runId: z.string().min(1),
      }),
      // What the rules of automation write: a move, a change, a comment
      z.object({
        type: z.enum(['issue:updated', 'issue:created', 'comment:added', 'board:moved']),
        projectId: z.string().min(1),
        issueId: z.string().min(1),
      }),
    ]),
  })
  // An event is about the project whose room it goes to
  .refine((m) => m.event.projectId === m.room.slice('project:'.length));

type Delivery = (room: string, event: RealtimeEvent) => void;

const LOG_EVERY_MS = 30_000;
const lastLogged = new Map<string, number>();

// One line per kind per half minute: an outage must not fill the log
function logLimited(kind: string, text: string, extra: Record<string, unknown> = {}): void {
  const now = Date.now();
  if (now - (lastLogged.get(kind) ?? 0) < LOG_EVERY_MS) return;
  lastLogged.set(kind, now);
  logger.warn(text, extra);
}

function connection(name: string, offlineQueue: boolean, url = REDIS_URL): Redis {
  const client = new Redis(url, {
    connectionName: name,
    // Never gives up; waits longer each time, to 5 seconds
    retryStrategy: (times) => Math.min(times * 250, 5000),
    maxRetriesPerRequest: null,
    // The publisher fails a command sent while disconnected at once instead of queueing it
    enableOfflineQueue: offlineQueue,
    lazyConnect: true,
  });
  client.on('error', (err: Error) =>
    logLimited(`${name}:error`, 'realtime bridge connection error', { name, error: err.message }),
  );
  client.on('end', () => logLimited(`${name}:end`, 'realtime bridge connection ended', { name }));
  client.on('ready', () => {
    logger.info('realtime bridge connected', { name });
  });
  return client;
}

let mode: 'local' | 'redis' = 'local';
let publisher: Redis | null = null;
let publisherName = '';

/**
 * Chooses how this process delivers realtime events: `local` (the default, the API) broadcasts to
 * its own sockets, `redis` (the worker) publishes for the API processes to broadcast and starts
 * its connection now.
 * @param next The mode
 */
export function setRealtimeMode(next: 'local' | 'redis'): void {
  mode = next;
  // In the worker every broadcastToRoom goes over the bridge: nothing there has sockets
  setPublishHook(next === 'redis' ? publishRealtime : null);
  if (next === 'redis' && !publisher) {
    publisherName = `axiom-rt-pub-${process.pid}-${randomUUID().slice(0, 8)}`;
    publisher = connection(publisherName, false);
    publisher.connect().catch(() => {
      // Retried by the connection itself; the error is logged by its handler
    });
  }
  if (next === 'local') closeRealtimePublisher();
}

/** Closes the publishing connection (the worker on shutdown). */
export function closeRealtimePublisher(): void {
  publisher?.disconnect();
  publisher = null;
}

/** The name of the publishing connection, for finding it in Redis (tests). */
export const realtimePublisherName = () => publisherName;

/** Resolves once the publishing connection is ready (tests, start-up). */
export async function realtimePublisherReady(): Promise<void> {
  const client = publisher;
  if (!client || client.status === 'ready') return;
  await new Promise<void>((resolve) => client.once('ready', () => resolve()));
}

/**
 * Sends an event to the browsers in a room, from whichever process produced it. In the worker
 * it is dropped (and logged, rate-limited) while Redis is unreachable.
 * @param room The room, such as `project:<id>`
 * @param event The event
 */
export function publishRealtime(room: string, event: RealtimeEvent): void {
  if (mode === 'local') {
    broadcastToRoom(room, event);
    return;
  }
  const client = publisher;
  if (!client || client.status !== 'ready') {
    logLimited('publish-dropped', 'realtime event dropped, Redis is not connected');
    return;
  }
  client.publish(REALTIME_CHANNEL, JSON.stringify({ room, event })).catch((err: unknown) => {
    logLimited('publish-failed', 'realtime publish failed', {
      error: err instanceof Error ? err.message : 'unknown',
    });
  });
}

function parse(raw: string): { room: string; event: RealtimeEvent } | null {
  try {
    const parsed = message.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Not JSON: dropped below
  }
  logLimited('message-dropped', 'realtime bridge dropped a message that is not allowed');
  return null;
}

export type RealtimeSubscriber = {
  /** Resolves once the channel is subscribed */
  ready: Promise<void>;
  /** The connection's name, for finding it in Redis (tests) */
  name: string;
  stop: () => void;
};

/**
 * Subscribes to the channel the worker publishes on and delivers each event to the sockets of
 * this process. Run in the API only. The subscription is retried until Redis answers and is
 * restored by the connection after every outage.
 * @param deliver Where an event goes (the broadcast to local sockets by default)
 * @param opts `url` overrides the Redis address (tests)
 * @param opts.url
 */
export function startRealtimeSubscriber(
  deliver: Delivery = broadcastLocal,
  opts: { url?: string } = {},
): RealtimeSubscriber {
  const name = `axiom-rt-sub-${process.pid}-${randomUUID().slice(0, 8)}`;
  const subscriber = connection(name, true, opts.url);
  let stopped = false;
  subscriber.on('message', (_channel, raw) => {
    // A closing connection still hands over what was already on the wire
    if (stopped) return;
    const parsed = parse(raw);
    if (parsed) deliver(parsed.room, parsed.event);
  });
  const ready = (async () => {
    subscriber.connect().catch(() => {
      // Retried by the connection itself
    });
    for (let wait = 500; !stopped; wait = Math.min(wait * 2, 10_000)) {
      try {
        await subscriber.subscribe(REALTIME_CHANNEL);
        return;
      } catch (err) {
        logLimited('subscribe-failed', 'realtime bridge cannot subscribe yet', {
          error: err instanceof Error ? err.message : 'unknown',
        });
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  })();
  return {
    ready,
    name,
    stop: () => {
      stopped = true;
      subscriber.disconnect();
    },
  };
}
