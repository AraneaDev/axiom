import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/api/orgs.api', () => ({ orgsApi: { list: vi.fn() } }));
vi.mock('@/api/teams.api', () => ({ teamsApi: { listByOrg: vi.fn() } }));
vi.mock('@/api/projects.api', () => ({ projectsApi: { listByTeam: vi.fn() } }));
vi.mock('@/api/service-accounts.api', () => ({ serviceAccountsApi: { get: vi.fn() } }));

import { orgsApi } from '@/api/orgs.api';
import { serviceAccountsApi } from '@/api/service-accounts.api';

import { Breadcrumbs } from './Breadcrumbs';

function at(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Breadcrumbs />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Breadcrumbs on the agent approval pages', () => {
  it('names the list, not an org, and links it to the list', () => {
    at('/approvals/agent/cmw3tngka0001abc');
    const list = screen.getByRole('link', { name: 'Agent approvals' });
    expect(list).toHaveAttribute('href', '/approvals/agent');
    expect(screen.getByText('Request')).toBeInTheDocument();
    expect(screen.queryByText(/Cmw3tngka/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Approvals' })).toBeNull();
  });

  it('shows the list alone as the current page', () => {
    at('/approvals/agent');
    expect(screen.getByText('Agent approvals')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Agent approvals' })).toBeNull();
  });
});

describe('Breadcrumbs on the account and admin pages', () => {
  it.each([
    ['/settings/connect-agent', 'Settings', 'Connect Agent'],
    ['/admin/users', 'Admin', 'Users'],
  ])('reads %s as a section and a page, not an org and a team', (path, section, page) => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[path]}>
          <Breadcrumbs />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const link = screen.getByRole('link', { name: section });
    expect(link).toHaveAttribute('href', `/${path.split('/')[1]}`);
    expect(screen.getByText(page)).toBeInTheDocument();
    expect(container.querySelector('.lucide-building-2')).toBeNull();
    expect(container.querySelector('.lucide-users')).toBeNull();
  });
});

describe('Breadcrumbs on the org settings pages', () => {
  it("names a bot's page by the bot's display name, never its id", async () => {
    vi.mocked(orgsApi.list).mockResolvedValue([
      { id: 'org-1', slug: 'acme-labs', name: 'Acme Labs', role: 'OWNER' },
    ] as never);
    vi.mocked(serviceAccountsApi.get).mockResolvedValue({
      id: 'cmw95deqx0001abc',
      displayName: 'Triage bot',
    } as never);
    at('/acme-labs/settings/service-accounts/cmw95deqx0001abc');
    expect(await screen.findByText('Triage bot')).toBeInTheDocument();
    expect(screen.queryByText(/Cmw95deqx/i)).toBeNull();
    expect(screen.getByRole('link', { name: 'Service accounts' })).toHaveAttribute(
      'href',
      '/acme-labs/settings/service-accounts',
    );
    expect(screen.getByRole('link', { name: 'Org settings' })).toHaveAttribute(
      'href',
      '/acme-labs/settings',
    );
    expect(serviceAccountsApi.get).toHaveBeenCalledWith('cmw95deqx0001abc');
  });

  it('does not read the org settings as a team', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/acme-labs/settings/agent-approvals']}>
          <Breadcrumbs />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Agent approvals')).toBeInTheDocument();
    expect(container.querySelector('.lucide-users')).toBeNull();
  });
});
