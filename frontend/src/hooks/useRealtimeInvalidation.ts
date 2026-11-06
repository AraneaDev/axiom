import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import { subscribe, unsubscribe, useWebSocket, useRealtimeListener } from './useWebSocket';

/**
 * Realtime event types (mirrors backend src/realtime/events.ts).
 */
export type RealtimeEvent =
  | { type: 'issue:updated'; projectId: string; issueId: string }
  | { type: 'issue:created'; projectId: string; issueId: string }
  | { type: 'issue:links-updated'; issueId: string }
  | { type: 'issue:development-updated'; projectId: string; issueIds: string[] }
  | { type: 'comment:added'; projectId: string; issueId: string }
  | { type: 'board:moved'; projectId: string; issueId: string }
  | { type: 'sprint:updated'; projectId: string; sprintId: string }
  | { type: 'wiki:updated'; spaceId: string; pageId?: string }
  | { type: 'notification'; userId: string; notificationId: string }
  | { type: 'agent:approval'; userId: string; approvalId: string; status: string }
  | { type: 'approval:request:created'; projectId: string; requestId: string; issueId: string }
  | {
      type: 'approval:request:updated';
      projectId: string;
      requestId: string;
      issueId: string;
      status: string;
    }
  | { type: 'form:submission:created'; projectId: string; submissionId: string; formId: string }
  | { type: 'subscribed'; room: string }
  | { type: 'subscribe:denied'; rooms: string[] }
  // The check failed (not refused): the room stays wanted and is asked for on reconnect
  | { type: 'subscribe:error'; room: string };

/**
 * Join a realtime room while mounted. Pass `null` while the id behind the room is still
 * loading; the hook subscribes once a room name is given and moves to the new room when it
 * changes. Room names use ids, as the server broadcasts and authorizes them:
 * `project:<projectId>`, `space:<spaceId>`, `issue:<issueId>`.
 * @param room - The room to join, or null to join nothing yet
 */
export function useRealtimeRoom(room: string | null | undefined): void {
  useEffect(() => {
    if (!room) return;
    subscribe([room]);
    return () => unsubscribe([room]);
  }, [room]);
}

/**
 * Hook that maps incoming realtime events to React Query cache invalidations.
 * Rooms are joined by the layouts that know their ids (see `useRealtimeRoom`); the
 * personal `user:<id>` room is joined by the server on connect.
 *
 * Call once in the authenticated app shell.
 */
export function useRealtimeInvalidation(): void {
  const queryClient = useQueryClient();
  // Owns the shared connection: connects after login, disconnects on logout
  useWebSocket();

  // Map events to query invalidations
  const handleEvent = useCallback(
    (event: RealtimeEvent) => {
      switch (event.type) {
        case 'issue:updated':
        case 'issue:created':
          queryClient.invalidateQueries({ queryKey: ['issues', event.projectId] });
          queryClient.invalidateQueries({ queryKey: ['board', event.projectId] });
          queryClient.invalidateQueries({ queryKey: ['issue', event.projectId] });
          break;

        case 'issue:links-updated':
          queryClient.invalidateQueries({ queryKey: ['issue-wiki-links'] });
          break;

        case 'issue:development-updated':
          // Keyed by project and issue number: the event has the id, so the project's issue pages refetch
          queryClient.invalidateQueries({ queryKey: ['issue-hydrate', event.projectId] });
          break;

        case 'comment:added':
          queryClient.invalidateQueries({ queryKey: ['issue', event.projectId] });
          break;

        case 'board:moved':
          queryClient.invalidateQueries({ queryKey: ['board', event.projectId] });
          break;

        case 'wiki:updated':
          queryClient.invalidateQueries({ queryKey: ['page', event.spaceId] });
          break;

        case 'notification':
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          break;

        case 'agent:approval':
          queryClient.invalidateQueries({ queryKey: ['agent-approvals'] });
          break;

        case 'approval:request:created':
          queryClient.invalidateQueries({
            queryKey: ['approval-requests-pending', event.projectId],
          });
          queryClient.invalidateQueries({ queryKey: ['approval-requests', event.issueId] });
          queryClient.invalidateQueries({ queryKey: ['my-pending-approvals'] });
          break;

        case 'approval:request:updated':
          queryClient.invalidateQueries({
            queryKey: ['approval-requests-pending', event.projectId],
          });
          queryClient.invalidateQueries({ queryKey: ['approval-requests', event.issueId] });
          queryClient.invalidateQueries({ queryKey: ['my-pending-approvals'] });
          // If approved, the issue may have moved -- refresh the board
          if (event.status === 'APPROVED') {
            queryClient.invalidateQueries({ queryKey: ['board', event.projectId] });
            queryClient.invalidateQueries({ queryKey: ['issues', event.projectId] });
          }
          break;
      }
    },
    [queryClient],
  );

  useRealtimeListener(handleEvent);
}
