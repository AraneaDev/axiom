import { get } from './client';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  services: {
    database: { status: 'up' | 'down'; latencyMs: number };
    redis: { status: 'up' | 'down' | 'not_configured'; latencyMs: number };
  };
}

export const healthApi = {
  check: () => get<HealthStatus>('/health'),
};
