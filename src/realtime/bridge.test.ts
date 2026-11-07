/**
 * The Redis bridge between the worker (which has no sockets) and the API (which has): the worker
 * publishes, the API subscribes and broadcasts. Two clients stand in for the two processes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { publishRealtime, setRealtimeMode, startRealtimeSubscriber } from './bridge';
import type { RealtimeEvent } from './events';

const broadcast = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]> }));
vi.mock('./broadcast', () => ({
  broadcastToRoom: (room: string, event: unknown) => {
    broadcast.calls.push([room, event]);
  },
}));

const event = (n: number): RealtimeEvent => ({
  type: 'issue:development-updated',
  projectId: `p${n}`,
  issueIds: ['i1'],
});
const stops: Array<() => Promise<void>> = [];

afterEach(async () => {
  setRealtimeMode('local');
  broadcast.calls.length = 0;
  while (stops.length) await stops.pop()!();
});

describe('realtime bridge', () => {
  it('broadcasts directly when this process is the API, and publishes nothing', async () => {
    const received: Array<[string, unknown]> = [];
    stops.push(await startRealtimeSubscriber((room, e) => void received.push([room, e])));

    publishRealtime('project:a', event(1));
    await new Promise((r) => setTimeout(r, 300));

    expect(broadcast.calls).toEqual([['project:a', event(1)]]);
    expect(received).toEqual([]);
  });

  it('publishes through Redis from the worker and the API subscriber broadcasts it once', async () => {
    setRealtimeMode('redis');
    const received: Array<[string, unknown]> = [];
    stops.push(await startRealtimeSubscriber((room, e) => void received.push([room, e])));

    publishRealtime('project:b', event(2));
    await vi.waitFor(() => expect(received).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 300));

    expect(received).toEqual([['project:b', event(2)]]);
    // The publishing process did not also broadcast on its own
    expect(broadcast.calls).toEqual([]);
  });

  it('ignores a message that is not a room and an event', async () => {
    const { redis } = await import('../config/redis');
    const received: unknown[] = [];
    stops.push(await startRealtimeSubscriber((room, e) => void received.push([room, e])));

    await redis.publish('axiom:realtime', 'not json');
    await redis.publish('axiom:realtime', JSON.stringify({ room: 5, event: {} }));
    await redis.publish('axiom:realtime', JSON.stringify({ room: 'project:c', event: event(3) }));
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received).toEqual([['project:c', event(3)]]);
  });
});
