/**
 * The Redis bridge between the worker (which has no sockets) and the API (which has): the worker
 * publishes, the API subscribes and broadcasts. Two clients stand in for the two processes.
 */
import { createServer, connect, type Server } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { REDIS_URL, redis } from '../config/redis';

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
vi.mock('./broadcast', () => {
  const record = (room: string, event: unknown) => {
    broadcast.calls.push([room, event]);
  };
  return { broadcastToRoom: record, broadcastLocal: record };
});

const ROOM = 'project:cbridgetest00000000000001';
const event = (n: number): RealtimeEvent => ({
  type: 'issue:development-updated',
  projectId: ROOM.slice('project:'.length),
  issueIds: [`i${n}`],
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

  it('delivers the issue, comment and board events automation emits, to project rooms only', async () => {
    await subscribe();
    const send = (room: string, type: string) =>
      redis.publish(
        REALTIME_CHANNEL,
        JSON.stringify({
          room,
          event: { type, projectId: ROOM.slice('project:'.length), issueId: 'i1' },
        }),
      );
    for (const type of ['issue:updated', 'issue:created', 'comment:added', 'board:moved']) {
      await send(ROOM, type);
    }
    // Not bridged: a person's room, and events no worker rule produces
    await send('user:cbridgetest00000000000001', 'issue:updated');
    await send(ROOM, 'wiki:updated');
    await send(ROOM, 'sprint:updated');
    await vi.waitFor(() => expect(received).toHaveLength(4));
    await new Promise((r) => setTimeout(r, 300));
    expect(received.map(([, e]) => (e as { type: string }).type)).toEqual([
      'issue:updated',
      'issue:created',
      'comment:added',
      'board:moved',
    ]);
  });

  it('delivers the progress of a GitHub Issues backfill to its project room only', async () => {
    await subscribe();
    const projectId = ROOM.slice('project:'.length);
    const progress = { type: 'github:import-progress', projectId, runId: 'r1' };
    await redis.publish(REALTIME_CHANNEL, JSON.stringify({ room: ROOM, event: progress }));
    // Not bridged: a person's room, another project's room, and a run without its id
    await redis.publish(
      REALTIME_CHANNEL,
      JSON.stringify({ room: 'user:cbridgetest00000000000001', event: progress }),
    );
    await redis.publish(
      REALTIME_CHANNEL,
      JSON.stringify({
        room: 'project:cbridgetest00000000000002',
        event: progress,
      }),
    );
    await redis.publish(
      REALTIME_CHANNEL,
      JSON.stringify({ room: ROOM, event: { type: 'github:import-progress', projectId } }),
    );
    await vi.waitFor(() => expect(received).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 300));
    expect(received).toEqual([[ROOM, progress]]);
  });

  it("drops an event whose project is not the room's project", async () => {
    await subscribe();
    await redis.publish(
      REALTIME_CHANNEL,
      JSON.stringify({
        room: ROOM,
        event: { type: 'issue:updated', projectId: 'cother', issueId: 'i1' },
      }),
    );
    await redis.publish(
      REALTIME_CHANNEL,
      JSON.stringify({
        room: ROOM,
        event: { type: 'issue:updated', projectId: ROOM.slice('project:'.length), issueId: 'i1' },
      }),
    );
    await vi.waitFor(() => expect(received).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 300));
    expect(received).toHaveLength(1);
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
        expect(received.some(([, e]) => (e as { issueIds: string[] }).issueIds[0] === 'i7')).toBe(
          true,
        );
      },
      { timeout: 10_000, interval: 300 },
    );
  });

  it('subscribes once Redis comes up when the API started while it was down', async () => {
    // A port nobody listens on, as Redis is not there yet
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const url = new URL(REDIS_URL);
    url.hostname = '127.0.0.1';
    url.port = String(port);
    const real = new URL(REDIS_URL);

    const subscriber = startRealtimeSubscriber((room, e) => void received.push([room, e]), {
      url: url.toString(),
    });
    subscribers.push(subscriber);
    let settled = false;
    void subscriber.ready.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 1500));
    expect(settled).toBe(false);

    // Redis comes up: a proxy to the real one on that port
    let proxy: Server | null = null;
    const sockets = new Set<import('node:net').Socket>();
    proxy = createServer((client) => {
      const upstream = connect(Number(real.port || 6379), real.hostname);
      sockets.add(client).add(upstream);
      client.pipe(upstream).pipe(client);
      client.on('error', () => upstream.destroy());
      upstream.on('error', () => client.destroy());
    });
    await new Promise<void>((resolve) => proxy!.listen(port, '127.0.0.1', resolve));
    try {
      await vi.waitFor(() => expect(settled).toBe(true), { timeout: 15_000, interval: 200 });
      await redis.publish(REALTIME_CHANNEL, JSON.stringify({ room: ROOM, event: event(9) }));
      await vi.waitFor(() => expect(received).toEqual([[ROOM, event(9)]]));
    } finally {
      subscriber.stop();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => proxy!.close(() => resolve()));
    }
  }, 30_000);

  it('stops delivering once the subscriber is stopped', async () => {
    const subscriber = await subscribe();
    subscriber.stop();

    await redis.publish(REALTIME_CHANNEL, JSON.stringify({ room: ROOM, event: event(8) }));
    await new Promise((r) => setTimeout(r, 300));

    expect(received).toEqual([]);
  });
});
