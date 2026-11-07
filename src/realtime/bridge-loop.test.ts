/**
 * A process in worker (redis) mode that also subscribes must not publish again what it receives.
 * The real broadcast module is used here, unlike in bridge.test.ts.
 */
import Redis from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';

import { REDIS_URL, redis } from '../config/redis';

import {
  REALTIME_CHANNEL,
  closeRealtimePublisher,
  realtimePublisherReady,
  setRealtimeMode,
  startRealtimeSubscriber,
} from './bridge';

const ROOM = 'project:cbridgeloop00000000000001';

afterEach(() => {
  setRealtimeMode('local');
  closeRealtimePublisher();
});

describe('bridge loop', () => {
  it('delivers a received event locally and never publishes it again', async () => {
    setRealtimeMode('redis');
    await realtimePublisherReady();
    const subscriber = startRealtimeSubscriber();
    await subscriber.ready;
    const watcher = new Redis(REDIS_URL);
    let seen = 0;
    watcher.on('message', () => seen++);
    await watcher.subscribe(REALTIME_CHANNEL);
    try {
      await redis.publish(
        REALTIME_CHANNEL,
        JSON.stringify({
          room: ROOM,
          event: { type: 'issue:updated', projectId: ROOM.slice('project:'.length), issueId: 'i1' },
        }),
      );
      await new Promise((r) => setTimeout(r, 800));
      expect(seen).toBe(1);
    } finally {
      subscriber.stop();
      watcher.disconnect();
    }
  });
});
