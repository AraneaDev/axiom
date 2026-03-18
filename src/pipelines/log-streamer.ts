/**
 * Pipeline log streamer.
 *
 * Accumulates log output in memory during pipeline execution,
 * persists to DB on completion, and broadcasts chunks via WebSocket
 * for real-time log viewing.
 */

import { broadcastToRoom } from '../realtime/ws-server';

interface LogEntry {
  timestamp: number;
  jobName: string;
  stepName: string;
  line: string;
}

/**
 * In-memory log accumulator for a pipeline run.
 */
export class LogStreamer {
  private runId: string;
  private repoId: string;
  private entries: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private pendingChunks: LogEntry[] = [];

  constructor(runId: string, repoId: string) {
    this.runId = runId;
    this.repoId = repoId;
    this.flushTimer = setInterval(() => this.flush(), 500);
  }

  /**
   * Append a log line from a job/step.
   * @param jobName
   * @param stepName
   * @param line
   */
  append(jobName: string, stepName: string, line: string): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      jobName,
      stepName,
      line,
    };
    this.entries.push(entry);
    this.pendingChunks.push(entry);
  }

  /**
   * Flush pending log chunks to WebSocket subscribers.
   */
  private flush(): void {
    if (this.pendingChunks.length === 0) return;

    const chunks = [...this.pendingChunks];
    this.pendingChunks = [];

    try {
      broadcastToRoom(`repo:${this.repoId}`, {
        type: 'pipeline:log',
        runId: this.runId,
        repoId: this.repoId,
        chunks: chunks.map((c) => ({
          timestamp: c.timestamp,
          jobName: c.jobName,
          stepName: c.stepName,
          line: c.line,
        })),
      });
    } catch {
      // WS broadcast is best-effort
    }
  }

  /**
   * Get the full accumulated log output as a single string.
   */
  getFullLog(): string {
    return this.entries.map((e) => `[${e.jobName}/${e.stepName}] ${e.line}`).join('\n');
  }

  /**
   * Get log entries for a specific job.
   * @param jobName
   */
  getJobLog(jobName: string): string {
    return this.entries
      .filter((e) => e.jobName === jobName)
      .map((e) => `[${e.stepName}] ${e.line}`)
      .join('\n');
  }

  /**
   * Stop the flush timer and flush any remaining chunks.
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }
}

/**
 * Active log streamers keyed by run ID.
 */
const activeStreamers = new Map<string, LogStreamer>();

/**
 * Create and register a log streamer for a pipeline run.
 * @param runId
 * @param repoId
 */
export function createLogStreamer(runId: string, repoId: string): LogStreamer {
  const streamer = new LogStreamer(runId, repoId);
  activeStreamers.set(runId, streamer);
  return streamer;
}

/**
 * Get an active log streamer by run ID.
 * @param runId
 */
export function getLogStreamer(runId: string): LogStreamer | undefined {
  return activeStreamers.get(runId);
}

/**
 * Remove and stop a log streamer.
 * @param runId
 */
export function removeLogStreamer(runId: string): void {
  const streamer = activeStreamers.get(runId);
  if (streamer) {
    streamer.stop();
    activeStreamers.delete(runId);
  }
}
