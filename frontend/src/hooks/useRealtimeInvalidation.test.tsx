import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();

vi.mock('@/hooks/useWebSocket', () => ({
  subscribe: (...args: unknown[]) => mockSubscribe(...args),
  unsubscribe: (...args: unknown[]) => mockUnsubscribe(...args),
  useWebSocket: () => ({
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    onEvent: vi.fn(),
    state: 'connected',
  }),
  useRealtimeListener: vi.fn(),
}));

const mockListOrgs = vi.fn();
const mockListTeams = vi.fn();
const mockListProjects = vi.fn();

vi.mock('@/api/orgs.api', () => ({ orgsApi: { list: () => mockListOrgs() } }));
vi.mock('@/api/teams.api', () => ({
  teamsApi: { listByOrg: (id: string) => mockListTeams(id) },
}));
vi.mock('@/api/projects.api', () => ({
  projectsApi: { listByTeam: (id: string) => mockListProjects(id) },
}));
vi.mock('@/components/layout/ProjectNavBar', () => ({ ProjectNavBar: () => null }));

import { ProjectLayout } from '@/components/layout/ProjectLayout';
import { useRealtimeListener } from '@/hooks/useWebSocket';

import { useRealtimeInvalidation, useRealtimeRoom } from './useRealtimeInvalidation';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('realtime room subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useRealtimeRoom waits for the id, then subscribes to the id-based room', () => {
    const { rerender, unmount } = renderHook(
      ({ id }: { id?: string }) => useRealtimeRoom(id ? `project:${id}` : null),
      { wrapper, initialProps: {} },
    );
    expect(mockSubscribe).not.toHaveBeenCalled();

    rerender({ id: 'proj-1' });
    expect(mockSubscribe).toHaveBeenCalledWith(['project:proj-1']);

    rerender({ id: 'proj-2' });
    expect(mockUnsubscribe).toHaveBeenCalledWith(['project:proj-1']);
    expect(mockSubscribe).toHaveBeenLastCalledWith(['project:proj-2']);

    unmount();
    expect(mockUnsubscribe).toHaveBeenLastCalledWith(['project:proj-2']);
  });

  it('ProjectLayout subscribes with the project id once the project has loaded', async () => {
    mockListOrgs.mockResolvedValue([{ id: 'org-1', slug: 'aranea', name: 'Aranea' }]);
    mockListTeams.mockResolvedValue([{ id: 'team-1', slug: 'axiom', name: 'Axiom' }]);
    mockListProjects.mockResolvedValue([{ id: 'proj-42', slug: 'axm', name: 'Axiom MVP' }]);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/aranea/axiom/axm/board']}>
          <Routes>
            <Route path="/:org/:team/:project" element={<ProjectLayout />}>
              <Route path="board" element={null} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledWith(['project:proj-42']));
    const rooms = mockSubscribe.mock.calls.flatMap((c) => c[0] as string[]);
    expect(rooms).toEqual(['project:proj-42']);
  });
});

describe('issue:development-updated', () => {
  function setup() {
    const qc = new QueryClient();
    qc.setQueryData(['issue-development', 'p1', '1', 'i1'], { id: 'one' });
    qc.setQueryData(['issue-development', 'p1', '2', 'i2'], { id: 'two' });
    qc.setQueryData(['issue-development', 'p2', '1', 'i1'], { id: 'other project' });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    vi.mocked(useRealtimeListener).mockClear();
    renderHook(() => useRealtimeInvalidation(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>
          <MemoryRouter>{children}</MemoryRouter>
        </QueryClientProvider>
      ),
    });
    const listener = vi.mocked(useRealtimeListener).mock.calls[0][0] as (e: unknown) => void;
    return { qc, spy, listener };
  }

  it('refetches the repository link and the panels of the issues named only', () => {
    const { qc, spy, listener } = setup();

    listener({ type: 'issue:development-updated', projectId: 'p1', issueIds: ['i1'] });

    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toContainEqual(['issue-development', 'p1']);
    expect(keys).toContainEqual(['github-repo', 'p1']);
    expect(keys).not.toContainEqual(['issue-hydrate', 'p1']);
    const state = (key: unknown[]) => qc.getQueryState(key)?.isInvalidated;
    expect(state(['issue-development', 'p1', '1', 'i1'])).toBe(true);
    expect(state(['issue-development', 'p1', '2', 'i2'])).toBe(false);
    expect(state(['issue-development', 'p2', '1', 'i1'])).toBe(false);
  });
});
