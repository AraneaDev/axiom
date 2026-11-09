import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ orgs: vi.fn(), bots: vi.fn() }));
const authUser = vi.hoisted(() => ({ current: { id: 'u1', isAdmin: false } }));

vi.mock('@/api/orgs.api', () => ({ orgsApi: { list: api.orgs } }));
vi.mock('@/api/teams.api', () => ({ teamsApi: { listByOrg: async () => [] } }));
vi.mock('@/api/projects.api', () => ({ projectsApi: { listByTeam: async () => [] } }));
vi.mock('@/api/service-accounts.api', () => ({ serviceAccountsApi: { list: api.bots } }));
vi.mock('@/hooks/usePendingAgentApprovals', () => ({ usePendingAgentApprovals: () => 0 }));
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (pick?: (s: { user: typeof authUser.current }) => unknown) =>
    pick ? pick({ user: authUser.current }) : { user: authUser.current },
}));
vi.mock('@/stores/ui.store', () => ({
  useUIStore: () => ({
    sidebarOpen: true,
    setSidebarOpen: vi.fn(),
    currentOrgId: 'org-1',
    setCurrentOrg: vi.fn(),
    setCurrentTeam: vi.fn(),
  }),
}));

import { Sidebar } from './Sidebar';

function show(role: string) {
  api.orgs.mockResolvedValue([{ id: 'org-1', slug: 'acme-labs', name: 'Acme Labs', role }]);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/acme-labs']}>
        <Routes>
          <Route path="/:org" element={<Sidebar />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Sidebar: Org settings', () => {
  beforeEach(() => {
    api.orgs.mockReset();
    api.bots.mockReset();
    authUser.current = { id: 'u1', isAdmin: false };
  });

  it.each(['OWNER', 'ADMIN'])('shows Org settings to an org %s', async (role) => {
    show(role);
    expect(await screen.findByRole('link', { name: /Org settings/ })).toHaveAttribute(
      'href',
      '/acme-labs/settings',
    );
    expect(api.bots).not.toHaveBeenCalled();
  });

  it('shows it to a member who owns a bot there', async () => {
    api.bots.mockResolvedValue([{ id: 'bot-1' }]);
    show('MEMBER');
    expect(await screen.findByRole('link', { name: /Org settings/ })).toBeInTheDocument();
  });

  it('hides it from a member who owns none', async () => {
    api.bots.mockRejectedValue(new Error('Only an org owner or admin manages service accounts'));
    show('MEMBER');
    await screen.findByRole('link', { name: /My Approvals/ });
    await waitFor(() => expect(api.bots).toHaveBeenCalledWith('org-1'));
    expect(screen.queryByRole('link', { name: /Org settings/ })).toBeNull();
  });

  it('hides it from a viewer, without asking', async () => {
    show('VIEWER');
    await screen.findByRole('link', { name: /My Approvals/ });
    expect(screen.queryByRole('link', { name: /Org settings/ })).toBeNull();
    expect(api.bots).not.toHaveBeenCalled();
  });
});
