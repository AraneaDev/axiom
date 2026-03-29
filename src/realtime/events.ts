/**
 * Realtime event type definitions for WebSocket broadcast.
 */

export type RealtimeEvent =
  | { type: 'issue:updated'; projectId: string; issueId: string }
  | { type: 'issue:created'; projectId: string; issueId: string }
  | { type: 'issue:development-updated'; issueId: string }
  | { type: 'comment:added'; projectId: string; issueId: string }
  | { type: 'board:moved'; projectId: string; issueId: string }
  | { type: 'pr:updated'; repoId: string; prId: string }
  | { type: 'pr:merged'; repoId: string; prId: string }
  | { type: 'wiki:updated'; spaceId: string; pageId: string }
  | { type: 'notification'; userId: string; notificationId: string }
  | { type: 'pipeline:updated'; repoId: string; runId: string }
  | { type: 'repo:pushed'; repoId: string; ref: string };

/**
 * Client-to-server message types.
 */
export type ClientMessage =
  | { type: 'subscribe'; rooms: string[] }
  | { type: 'unsubscribe'; rooms: string[] };
