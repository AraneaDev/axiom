import Redis from 'ioredis';

import { logger } from '../utils/logger';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const DEFAULT_TTL = 60;

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
  retryStrategy(times) {
    if (times > 3) return null;
    return Math.min(times * 200, 2000);
  },
});

let connected = false;

redis
  .connect()
  .then(() => {
    connected = true;
    logger.info('Redis connected');
  })
  .catch((_err) => {
    connected = false;
    logger.warn('Redis unavailable, caching disabled');
  });

redis.on('error', () => {
  connected = false;
  logger.warn('Redis connection error');
});

redis.on('connect', () => {
  connected = true;
});

/**
 *
 * @param key
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!connected) return null;
  try {
    const raw = await redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 *
 * @param key
 * @param data
 * @param ttlSeconds
 */
export async function cacheSet(key: string, data: unknown, ttlSeconds?: number): Promise<void> {
  if (!connected) return;
  try {
    const ttl = ttlSeconds ?? DEFAULT_TTL;
    await redis.set(key, JSON.stringify(data), 'EX', ttl);
  } catch {
    // Silently fail -- cache is best-effort
  }
}

/**
 *
 * @param patterns
 */
export async function cacheInvalidate(...patterns: string[]): Promise<void> {
  if (!connected) return;
  try {
    for (const pattern of patterns) {
      if (pattern.includes('*')) {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
          cursor = nextCursor;
          if (keys.length > 0) {
            await redis.del(...keys);
          }
        } while (cursor !== '0');
      } else {
        await redis.del(pattern);
      }
    }
  } catch {
    // Silently fail
  }
}

/**
 *
 * @param key
 * @param ttl
 * @param fn
 */
export async function cacheable<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;
  const result = await fn();
  await cacheSet(key, result, ttl);
  return result;
}
