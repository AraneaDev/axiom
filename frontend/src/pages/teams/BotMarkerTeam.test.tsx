import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const teams = vi.hoisted(() => ({
  get: vi.fn(),
  listMembers: vi.fn(),
  getActivity: vi.fn(),
  getMemberProfile: vi.fn(),
}));
vi.mock('@/api/teams.api', () => ({ teamsApi: teams }));
vi.mock('@/api/projects.api', () => ({ projectsApi: { listByTeam: async () => [] } }));
vi.mock('@/api/wiki.api', () => ({ wikiApi: { listSpaces: async () => [] } }));
vi.mock('@/hooks/useTeamContext', () => ({
  useTeamContext: () => ({
    org: 'acme-labs',
    teamSlug: 'core',
    currentOrg: { id: 'org-1' },
    currentTeam: { id: 't1', name: 'Core' },
  }),
}));

import MemberProfile from './MemberProfile';
import TeamDetail from './TeamDetail';

const bot = {
  id: 'b1',
  username: 'nightly-triage',
  displayName: 'Nightly Triage',
  avatarUrl: null,
  kind: 'SERVICE' as const,
};
const person = {
  id: 'u1',
  username: 'jan',
  displayName: 'Jan Voorbeeld',
  avatarUrl: null,
  kind: 'PERSON' as const,
};

function show(path: string, element: React.ReactNode, route: string) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the bot marker in team views', () => {
  beforeEach(() => {
    Object.values(teams).forEach((fn) => fn.mockReset());
    teams.getActivity.mockResolvedValue([]);
  });

  it("the team overview's member list shows the team's bots, marked", async () => {
    // team.get lists people only, as pickers need; the overview reads the member list
    teams.get.mockResolvedValue({ id: 't1', name: 'Core', members: [] });
    teams.listMembers.mockResolvedValue([
      { id: 'm1', userId: 'u1', role: 'MEMBER', user: person },
      { id: 'm2', userId: 'b1', role: 'MEMBER', user: bot },
    ]);
    show('/acme-labs/core', <TeamDetail />, '/:org/:team');
    expect(await screen.findByText('Nightly Triage')).toBeInTheDocument();
    expect(screen.getByText('Jan Voorbeeld')).toBeInTheDocument();
    expect(screen.getAllByText('bot')).toHaveLength(1);
    expect(teams.listMembers).toHaveBeenCalledWith('t1');
  });

  it("a bot's member profile marks it in the header and in its activity", async () => {
    teams.getMemberProfile.mockResolvedValue({
      ...bot,
      createdAt: '2026-11-01T00:00:00Z',
      role: 'MEMBER',
      joinedAt: '2026-11-01T00:00:00Z',
      assignedIssuesCount: 0,
      recentActivity: [
        {
          id: 'a1',
          action: 'commented',
          resourceType: 'ISSUE',
          resourceId: 'i1',
          details: null,
          createdAt: '2026-11-02T00:00:00Z',
          via: null,
          user: bot,
        },
      ],
    });
    show(
      '/acme-labs/core/members/nightly-triage',
      <MemberProfile />,
      '/:org/:team/members/:username',
    );
    expect(await screen.findAllByText('Nightly Triage')).toHaveLength(2);
    expect(screen.getAllByText('bot')).toHaveLength(2);
  });
});
