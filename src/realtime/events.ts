/**
 * Realtime event type definitions for WebSocket broadcast.
 */

export type RealtimeEvent =
  | { type: 'issue:updated'; projectId: string; issueId: string }
  | { type: 'issue:created'; projectId: string; issueId: string }
  | { type: 'issue:links-updated'; issueId: string }
  | { type: 'comment:added'; projectId: string; issueId: string }
  | { type: 'board:moved'; projectId: string; issueId: string }
  // A sprint started or completed
  | { type: 'sprint:updated'; projectId: string; sprintId: string }
  // pageId is left out for VIEW-restricted pages: the space room includes members who can't see them
  | { type: 'wiki:updated'; spaceId: string; pageId?: string }
  | { type: 'notification'; userId: string; notificationId: string }
  | { type: 'approval:request:created'; projectId: string; requestId: string; issueId: string }
  | {
      type: 'approval:request:updated';
      projectId: string;
      requestId: string;
      issueId: string;
      status: string;
    }
  | { type: 'form:submission:created'; projectId: string; submissionId: string; formId: string };

/**
 * Replies the server sends about a socket's own subscriptions. Not broadcast to rooms.
 * Mirrored in the frontend's RealtimeEvent (frontend/src/hooks/useRealtimeInvalidation.ts).
 */
export type SubscriptionMessage =
  | { type: 'subscribed'; room: string }
  | { type: 'subscribe:denied'; rooms: string[] }
  | { type: 'subscribe:error'; room: string };

/** Everything the server sends on the realtime socket. */
export type ServerMessage = RealtimeEvent | SubscriptionMessage;

/**
 * Client-to-server message types.
 */
export type ClientMessage =
  | { type: 'subscribe'; rooms: string[] }
  | { type: 'unsubscribe'; rooms: string[] };
