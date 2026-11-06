import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/components/ui/Toast';

const api = vi.hoisted(() => ({ list: vi.fn(), upsert: vi.fn(), remove: vi.fn() }));
const teams = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/api/teams.api', () => ({ teamsApi: teams }));
vi.mock('@/api/space-permissions.api', () => ({ spacePermissionsApi: api }));

import { SpacePermissions } from './SpacePermissions';

const holder = {
  id: 'perm1',
  spaceId: 's1',
  userId: 'u1',
  teamRole: null,
  level: 'EDIT',
  createdAt: '2026-11-01T10:00:00.000Z',
  user: { id: 'u1', username: 'mira', displayName: 'Mira Veld', avatarUrl: null },
};

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SpacePermissions spaceId="s1" teamId="t1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.upsert.mockResolvedValue({});
  api.remove.mockResolvedValue(undefined);
  teams.get.mockResolvedValue({
    id: 't1',
    members: [
      {
        id: 'm2',
        userId: 'u2',
        role: 'MEMBER',
        user: { id: 'u2', username: 'joris', displayName: 'Joris Bakker' },
      },
    ],
  });
});

describe('SpacePermissions', () => {
  it('says all team members have access when nothing is set', async () => {
    api.list.mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText('No custom permissions')).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledWith('s1');
  });

  it('lists who holds what', async () => {
    api.list.mockResolvedValue([holder]);
    renderPanel();
    expect(await screen.findByText('Mira Veld')).toBeInTheDocument();
    expect(screen.getByText('@mira')).toBeInTheDocument();
  });

  it('removes a permission', async () => {
    api.list.mockResolvedValue([holder]);
    renderPanel();
    await userEvent.click(await screen.findByTitle('Remove permission'));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('s1', 'perm1'));
  });

  it('adds a permission for a team role', async () => {
    api.list.mockResolvedValue([holder]);
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /^add$/i }));
    await userEvent.click(screen.getByRole('button', { name: /add permission/i }));
    await waitFor(() =>
      expect(api.upsert).toHaveBeenCalledWith('s1', { teamRole: 'MEMBER', level: 'VIEW' }),
    );
  });

  it('grants a team member access by picking them by name', async () => {
    api.list.mockResolvedValue([holder]);
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /^add$/i }));
    await userEvent.click(screen.getByRole('button', { name: /team role/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Member' }));
    await userEvent.click(await screen.findByRole('button', { name: /joris bakker/i }));
    await userEvent.click(screen.getByRole('button', { name: /add permission/i }));
    await waitFor(() =>
      expect(api.upsert).toHaveBeenCalledWith('s1', { userId: 'u2', level: 'VIEW' }),
    );
  });
});
