import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { onReconnect, subscribe, unsubscribe, useRealtimeListener } from './useWebSocket';

/** How long a refetch waits after the first event, so a burst of events costs one render */
export const LIVE_REFETCH_MS = 2000;

/** The events that can change what a widget shows. A comment changes no number. */
const LIVE_EVENTS = new Set(['issue:created', 'issue:updated', 'board:moved', 'sprint:updated']);

/**
 * The query key of a dashboard's render.
 * @param id - The dashboard
 */
export const dashboardRenderKey = (id: string) => ['dashboard-render', id];

/**
 * Keep a dashboard's render current while it is open: join the rooms of the projects it reads, and
 * refetch after a change in one. The wait starts at the first event and later ones do not extend
 * it, so that a busy project cannot hold the refetch back for good. A hidden tab refetches nothing
 * and catches up once when it is visible again, as it does after a socket drop: events were missed.
 * @param dashboardId - The dashboard
 * @param projectIds - The projects it reads, from its render
 */
export function useDashboardLive(dashboardId: string, projectIds: readonly string[]): void {
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A new render brings a new array: only other projects are a reason to move
  const joined = projectIds.join(',');

  const stopWaiting = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const refetch = useCallback(() => {
    stopWaiting();
    void queryClient.invalidateQueries({ queryKey: dashboardRenderKey(dashboardId) });
  }, [dashboardId, queryClient, stopWaiting]);

  useEffect(() => {
    if (!joined) return;
    const rooms = joined.split(',').map((id) => `project:${id}`);
    subscribe(rooms);
    return () => unsubscribe(rooms);
  }, [joined]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) stopWaiting();
      else refetch();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const stopListening = onReconnect(() => {
      if (document.hidden) stopWaiting();
      else refetch();
    });
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopListening();
      stopWaiting();
    };
  }, [refetch, stopWaiting]);

  useRealtimeListener((event) => {
    if (!LIVE_EVENTS.has(event.type) || !('projectId' in event)) return;
    if (document.hidden || timer.current || !projectIds.includes(event.projectId)) return;
    timer.current = setTimeout(refetch, LIVE_REFETCH_MS);
  });
}
