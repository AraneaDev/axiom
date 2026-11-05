import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { subscribe, unsubscribe, useRealtimeListener } from './useWebSocket';

/** How long a refetch waits after the first event, so a burst of events costs one render */
export const LIVE_REFETCH_MS = 2000;

/** The events that can change what a widget shows. A comment changes no number. */
const LIVE_EVENTS = new Set(['issue:created', 'issue:updated', 'board:moved']);

/**
 * The query key of a dashboard's render.
 * @param id - The dashboard
 */
export const dashboardRenderKey = (id: string) => ['dashboard-render', id];

/**
 * Keep a dashboard's render current while it is open: join the rooms of the projects it reads, and
 * refetch after a change in one. The wait starts at the first event and later ones do not extend
 * it, so that a busy project cannot hold the refetch back for good.
 * @param dashboardId - The dashboard
 * @param projectIds - The projects it reads, from its render
 */
export function useDashboardLive(dashboardId: string, projectIds: readonly string[]): void {
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A new render brings a new array: only other projects are a reason to move
  const joined = projectIds.join(',');

  useEffect(() => {
    if (!joined) return;
    const rooms = joined.split(',').map((id) => `project:${id}`);
    subscribe(rooms);
    return () => unsubscribe(rooms);
  }, [joined]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  useRealtimeListener((event) => {
    if (!LIVE_EVENTS.has(event.type) || !('projectId' in event)) return;
    if (timer.current || !projectIds.includes(event.projectId)) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      void queryClient.invalidateQueries({ queryKey: dashboardRenderKey(dashboardId) });
    }, LIVE_REFETCH_MS);
  });
}
