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
  | { type: 'comment:added'; projectId: string; issueId: string }
  | { type: 'board:moved'; projectId: string; issueId: string }
  | { type: 'pr:updated'; repoId: string; prId: string }
  | { type: 'pr:merged'; repoId: string; prId: string }
  | { type: 'wiki:updated'; spaceId: string; pageId: string }
  | { type: 'notification'; userId: string; notificationId: string }
  | { type: 'pipeline:updated'; repoId: string; runId: string }
  | { type: 'repo:pushed'; repoId: string; ref: string }
  | { type: 'runner-task:updated'; repoId: string; taskId: string }
  | { type: 'approval:request:created'; projectId: string; issueId: string }
  | { type: 'approval:request:resolved'; projectId: string; issueId: string; status: string };

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
    repo?: string;
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

    // If on a repo page, subscribe to repo-level events
    if (params.repo) {
      rooms.push(`repo:${params.org}/${params.team}/${params.repo}`);
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
  }, [params.org, params.team, params.project, params.repo, params.space, subscribe, unsubscribe]);

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

        case 'comment:added':
          queryClient.invalidateQueries({ queryKey: ['issue', event.projectId] });
          break;

        case 'board:moved':
          queryClient.invalidateQueries({ queryKey: ['board', event.projectId] });
          break;

        case 'pr:updated':
        case 'pr:merged':
          queryClient.invalidateQueries({ queryKey: ['prs', event.repoId] });
          queryClient.invalidateQueries({ queryKey: ['pr', event.repoId] });
          break;

        case 'wiki:updated':
          queryClient.invalidateQueries({ queryKey: ['page', event.spaceId] });
          break;

        case 'notification':
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          break;

        case 'pipeline:updated':
          queryClient.invalidateQueries({ queryKey: ['pipeline', event.repoId] });
          queryClient.invalidateQueries({ queryKey: ['pipelines', event.repoId] });
          queryClient.invalidateQueries({ queryKey: ['pipeline-runs', event.repoId] });
          queryClient.invalidateQueries({ queryKey: ['pipeline-run', event.runId] });
          queryClient.invalidateQueries({ queryKey: ['pipeline-run'] });
          break;

        case 'repo:pushed':
          queryClient.invalidateQueries({ queryKey: ['tree'] });
          queryClient.invalidateQueries({ queryKey: ['blob'] });
          queryClient.invalidateQueries({ queryKey: ['commits'] });
          queryClient.invalidateQueries({ queryKey: ['branches'] });
          queryClient.invalidateQueries({ queryKey: ['prs', event.repoId] });
          break;

        case 'approval:request:created':
          queryClient.invalidateQueries({
            queryKey: ['approval-requests-pending', event.projectId],
          });
          queryClient.invalidateQueries({ queryKey: ['approval-requests', event.issueId] });
          queryClient.invalidateQueries({ queryKey: ['my-pending-approvals'] });
          break;

        case 'approval:request:resolved':
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
