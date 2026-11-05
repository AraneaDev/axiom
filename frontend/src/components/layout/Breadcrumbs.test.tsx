import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/api/orgs.api', () => ({ orgsApi: { list: vi.fn() } }));
vi.mock('@/api/teams.api', () => ({ teamsApi: { listByOrg: vi.fn() } }));
vi.mock('@/api/projects.api', () => ({ projectsApi: { listByTeam: vi.fn() } }));

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
