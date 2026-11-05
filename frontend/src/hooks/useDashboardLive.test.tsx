import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
let emit: (event: unknown) => void = () => {};

vi.mock('@/hooks/useWebSocket', () => ({
  subscribe: (...args: unknown[]) => mockSubscribe(...args),
  unsubscribe: (...args: unknown[]) => mockUnsubscribe(...args),
  useRealtimeListener: (callback: (event: unknown) => void) => {
    emit = callback;
  },
}));

import { LIVE_REFETCH_MS, useDashboardLive } from './useDashboardLive';

describe('useDashboardLive', () => {
  let client: QueryClient;
  let invalidate: ReturnType<typeof vi.spyOn>;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const updated = (projectId: string) => ({ type: 'issue:updated', projectId, issueId: 'i1' });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    client = new QueryClient();
    invalidate = vi.spyOn(client, 'invalidateQueries');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits 2 seconds', () => {
    expect(LIVE_REFETCH_MS).toBe(2000);
  });

  it('joins the rooms of its projects, and leaves them on unmount', () => {
    const { unmount } = renderHook(() => useDashboardLive('d1', ['p1', 'p2']), { wrapper });
    expect(mockSubscribe).toHaveBeenCalledWith(['project:p1', 'project:p2']);
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledWith(['project:p1', 'project:p2']);
  });

  it('does not rejoin when the same projects arrive in a new array', () => {
    const { rerender } = renderHook(({ ids }: { ids: string[] }) => useDashboardLive('d1', ids), {
      wrapper,
      initialProps: { ids: ['p1'] },
    });
    rerender({ ids: ['p1'] });
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribe).not.toHaveBeenCalled();
  });

  it('moves when the projects change', () => {
    const { rerender } = renderHook(({ ids }: { ids: string[] }) => useDashboardLive('d1', ids), {
      wrapper,
      initialProps: { ids: ['p1'] },
    });
    rerender({ ids: ['p2'] });
    expect(mockUnsubscribe).toHaveBeenCalledWith(['project:p1']);
    expect(mockSubscribe).toHaveBeenLastCalledWith(['project:p2']);
  });

  it('refetches the render 2 seconds after an event, once for a burst', () => {
    renderHook(() => useDashboardLive('d1', ['p1']), { wrapper });
    act(() => {
      emit(updated('p1'));
      emit({ type: 'board:moved', projectId: 'p1', issueId: 'i2' });
      emit({ type: 'issue:created', projectId: 'p1', issueId: 'i3' });
    });
    expect(invalidate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(LIVE_REFETCH_MS);
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard-render', 'd1'] });
  });

  it('keeps refetching under a steady stream of events', () => {
    renderHook(() => useDashboardLive('d1', ['p1']), { wrapper });
    for (let i = 0; i < 6; i++) {
      act(() => {
        emit(updated('p1'));
        vi.advanceTimersByTime(LIVE_REFETCH_MS / 2);
      });
    }
    expect(invalidate.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('ignores other projects and events that change no number', () => {
    renderHook(() => useDashboardLive('d1', ['p1']), { wrapper });
    act(() => {
      emit(updated('p2'));
      emit({ type: 'comment:added', projectId: 'p1', issueId: 'i1' });
      emit({ type: 'notification', userId: 'u1', notificationId: 'n1' });
      vi.advanceTimersByTime(LIVE_REFETCH_MS * 2);
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('does not refetch after unmount', () => {
    const { unmount } = renderHook(() => useDashboardLive('d1', ['p1']), { wrapper });
    act(() => emit(updated('p1')));
    unmount();
    act(() => {
      vi.advanceTimersByTime(LIVE_REFETCH_MS);
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
