import { prisma } from '../../config/database';
import { redis } from '../../config/redis';

const startTime = Date.now();

interface HealthResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  services: {
    database: { status: 'up' | 'down'; latencyMs: number };
    redis: { status: 'up' | 'down' | 'not_configured'; latencyMs: number };
  };
}

/**
 * Check the health of all services and return an aggregate status.
 * @returns Health check result with service statuses and latencies
 */
export async function checkHealth(): Promise<HealthResult> {
  const result: HealthResult = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: '0.1.0-alpha',
    services: {
      database: { status: 'up', latencyMs: 0 },
      redis: { status: 'not_configured', latencyMs: 0 },
    },
  };

  // Check database
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    result.services.database = { status: 'up', latencyMs: Date.now() - dbStart };
  } catch {
    result.services.database = { status: 'down', latencyMs: 0 };
  }

  // Check Redis
  try {
    if (redis.status === 'ready') {
      const redisStart = Date.now();
      await redis.ping();
      result.services.redis = { status: 'up', latencyMs: Date.now() - redisStart };
    } else {
      result.services.redis = { status: 'down', latencyMs: 0 };
    }
  } catch {
    result.services.redis = { status: 'down', latencyMs: 0 };
  }

  // Determine overall status
  if (result.services.database.status === 'down') {
    result.status = 'unhealthy';
  } else if (result.services.redis.status === 'down') {
    result.status = 'degraded';
  }

  return result;
}
