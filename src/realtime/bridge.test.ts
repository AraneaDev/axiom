/**
 * The Redis bridge between the worker (which has no sockets) and the API (which has): the worker
 * publishes, the API subscribes and broadcasts. Two clients stand in for the two processes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { redis } from '../config/redis';

import {
  REALTIME_CHANNEL,
  closeRealtimePublisher,
  publishRealtime,
  realtimePublisherName,
  realtimePublisherReady,
  setRealtimeMode,
  startRealtimeSubscriber,
  type RealtimeSubscriber,
} from './bridge';
import type { RealtimeEvent } from './events';

const broadcast = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]> }));
vi.mock('./broadcast', () => ({
  broadcastToRoom: (room: string, event: unknown) => {
    broadcast.calls.push([room, event]);
  },
}));

const ROOM = 'project:cbridgetest00000000000001';
const event = (n: number): RealtimeEvent => ({
  type: 'issue:development-updated',
  projectId: `p${n}`,
  issueIds: ['i1'],
});
const subscribers: RealtimeSubscriber[] = [];
const received: Array<[string, unknown]> = [];

const subscribe = async () => {
  const subscriber = startRealtimeSubscriber((room, e) => void received.push([room, e]));
  subscribers.push(subscriber);
  await subscriber.ready;
  return subscriber;
};

/**
 * Closes one named connection from the Redis side, as a restart or a network blip would.
 * @param name The connection's name
 */
async function killConnection(name: string) {
  const list = (await redis.client('LIST')) as string;
  const line = list.split('\n').find((l) => l.includes(`name=${name} `));
  const id = /id=(\d+)/.exec(line ?? '')?.[1];
  expect(id, `connection ${name}`).toBeDefined();
  await redis.client('KILL', 'ID', id!);
}

afterEach(() => {
  setRealtimeMode('local');
  closeRealtimePublisher();
  broadcast.calls.length = 0;
  received.length = 0;
  while (subscribers.length) subscribers.pop()!.stop();
});

describe('realtime bridge', () => {
  it('broadcasts directly when this process is the API, and publishes nothing', async () => {
    await subscribe();

    publishRealtime(ROOM, event(1));
    await new Promise((r) => setTimeout(r, 300));

    expect(broadcast.calls).toEqual([[ROOM, event(1)]]);
    expect(received).toEqual([]);
  });

  it('publishes through Redis from the worker and the API subscriber broadcasts it once', async () => {
    setRealtimeMode('redis');
    await realtimePublisherReady();
    await subscribe();

    publishRealtime(ROOM, event(2));
    await vi.waitFor(() => expect(received).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 300));

    expect(received).toEqual([[ROOM, event(2)]]);
    // The publishing process did not also broadcast on its own
    expect(broadcast.calls).toEqual([]);
  });

  it('drops what is not a project room and an event the worker sends, and delivers the rest', async () => {
    await subscribe();
    const send = (value: unknown) =>
      redis.publish(REALTIME_CHANNEL, typeof value === 'string' ? value : JSON.stringify(value));

    await send('not json');
    await send({ room: 5, event: {} });
    // A room of another kind, such as one person's, and an event type that is not bridged
    await send({ room: 'user:cbridgetest00000000000001', event: event(3) });
    await send({ room: ROOM, event: { type: 'agent:approval', projectId: 'p' } });
    await send({ room: 'project:x', event: event(3) });
    await send({ room: ROOM, event: event(4) });

    await vi.waitFor(() => expect(received).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 300));
    expect(received).toEqual([[ROOM, event(4)]]);
  });

  it('keeps receiving after the subscriber lost its connection', async () => {
    const subscriber = await subscribe();
    await killConnection(subscriber.name);

    // Events published during the gap are lost; once the connection is back they arrive again
    await vi.waitFor(
      async () => {
        await redis.publish(REALTIME_CHANNEL, JSON.stringify({ room: ROOM, event: event(5) }));
        expect(received.length).toBeGreaterThan(0);
      },
      { timeout: 10_000, interval: 300 },
    );
    expect(received[0]).toEqual([ROOM, event(5)]);
  });

  it('keeps publishing after the publisher lost its connection, dropping meanwhile', async () => {
    setRealtimeMode('redis');
    await realtimePublisherReady();
    await subscribe();
    await killConnection(realtimePublisherName());

    // Nothing throws while it is down
    expect(() => publishRealtime(ROOM, event(6))).not.toThrow();
    await vi.waitFor(
      async () => {
        publishRealtime(ROOM, event(7));
        expect(received.some(([, e]) => (e as { projectId: string }).projectId === 'p7')).toBe(
          true,
        );
      },
      { timeout: 10_000, interval: 300 },
    );
  });

  it('stops delivering once the subscriber is stopped', async () => {
    const subscriber = await subscribe();
    subscriber.stop();

    await redis.publish(REALTIME_CHANNEL, JSON.stringify({ room: ROOM, event: event(8) }));
    await new Promise((r) => setTimeout(r, 300));

    expect(received).toEqual([]);
  });
});
