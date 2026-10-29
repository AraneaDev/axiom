import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router';

import { useWebSocket, useRealtimeListener } from './useWebSocket';

/**
 * Realtime event types (mirrors backend src/realtime/events.ts).
 */
export type RealtimeEvent =
  | { type: 'issue:updated'; projectId: string; issueId: string }
  | { type: 'issue:created'; projectId: string; issueId: string }
  | { type: 'issue:links-updated'; issueId: string }
  | { type: 'comment:added'; projectId: string; issueId: string }
  | { type: 'board:moved'; projectId: string; issueId: string }
  | { type: 'wiki:updated'; spaceId: string; pageId: string }
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
 * Hook that auto-subscribes to relevant rooms based on current route context
 * and maps incoming realtime events to React Query cache invalidations.
 *
 * Call once in the authenticated app shell.
 */
export function useRealtimeInvalidation(): void {
  const queryClient = useQueryClient();
  const { subscribe, unsubscribe } = useWebSocket();
  const params = useParams<{
    org?: string;
    team?: string;
    project?: string;
    space?: string;
    num?: string;
  }>();

  const prevRoomsRef = useRef<string[]>([]);

  // Compute rooms to subscribe to based on current route params
  useEffect(() => {
    const rooms: string[] = [];

    // If on a project page, subscribe to project-level events
    // We use the project slug as room identifier since we don't have IDs on the frontend route
    if (params.project) {
      rooms.push(`project:${params.org}/${params.team}/${params.project}`);
    }

    // If on a wiki page, subscribe to space-level events
    if (params.space) {
      rooms.push(`space:${params.org}/${params.team}/${params.space}`);
    }

    // Unsubscribe from old rooms
    const oldRooms = prevRoomsRef.current.filter((r) => !rooms.includes(r));
    if (oldRooms.length > 0) {
      unsubscribe(oldRooms);
    }

    // Subscribe to new rooms
    const newRooms = rooms.filter((r) => !prevRoomsRef.current.includes(r));
    if (newRooms.length > 0) {
      subscribe(newRooms);
    }

    prevRoomsRef.current = rooms;

    return () => {
      if (rooms.length > 0) {
        unsubscribe(rooms);
      }
    };
  }, [params.org, params.team, params.project, params.space, subscribe, unsubscribe]);

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
