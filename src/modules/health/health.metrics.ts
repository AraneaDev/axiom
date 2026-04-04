interface RequestRecord {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}

interface MetricsSnapshot {
  totalRequests: number;
  statusCodes: Record<string, number>;
  avgDurationMs: number;
  uptimeSeconds: number;
  startedAt: string;
}

export class MetricsCollector {
  private totalRequests = 0;
  private totalDurationMs = 0;
  private statusBuckets: Record<string, number> = {
    '2xx': 0,
    '3xx': 0,
    '4xx': 0,
    '5xx': 0,
  };
  private readonly startedAt = new Date();

  record(req: RequestRecord): void {
    this.totalRequests++;
    this.totalDurationMs += req.durationMs;

    const bucket = `${Math.floor(req.statusCode / 100)}xx`;
    if (bucket in this.statusBuckets) {
      this.statusBuckets[bucket]++;
    }
  }

  snapshot(): MetricsSnapshot {
    return {
      totalRequests: this.totalRequests,
      statusCodes: { ...this.statusBuckets },
      avgDurationMs:
        this.totalRequests > 0 ? Math.round(this.totalDurationMs / this.totalRequests) : 0,
      uptimeSeconds: Math.round((Date.now() - this.startedAt.getTime()) / 1000),
      startedAt: this.startedAt.toISOString(),
    };
  }

  reset(): void {
    this.totalRequests = 0;
    this.totalDurationMs = 0;
    for (const key of Object.keys(this.statusBuckets)) {
      this.statusBuckets[key] = 0;
    }
  }
}

/** Singleton instance used by middleware and health routes */
export const metrics = new MetricsCollector();
