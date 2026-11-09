import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The api client reads its tokens from localStorage when it loads
vi.hoisted(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
const api = vi.hoisted(() => ({
  orgs: vi.fn(),
  members: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
}));
const authUser = vi.hoisted(() => ({ current: { id: 'u-viewer', isAdmin: false } }));

vi.mock('@/api/orgs.api', () => ({
  orgsApi: { list: api.orgs, listMembers: api.members },
}));
vi.mock('@/api/service-accounts.api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/api/service-accounts.api')>();
  return { ...real, serviceAccountsApi: { list: api.list, create: api.create } };
});
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (pick?: (s: { user: typeof authUser.current }) => unknown) =>
    pick ? pick({ user: authUser.current }) : { user: authUser.current },
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { ApiError } from '@/api/client';

import ServiceAccounts from './ServiceAccounts';

const ORG = { id: 'org-1', slug: 'acme-labs', name: 'Acme Labs' };

function bot(over: Record<string, unknown> = {}) {
  return {
    id: 'bot-1',
    orgId: ORG.id,
    username: 'nightly-triage',
    displayName: 'Nightly Triage',
    avatarUrl: null,
    description: 'Triages the backlog every night',
    status: 'ACTIVE',
    suspendedReason: null,
    suspendedAt: null,
    createdById: 'u-admin',
    createdAt: '2026-11-01T00:00:00Z',
    owners: [{ id: 'u-viewer', username: 'jan', displayName: 'Jan Voorbeeld' }],
    teams: [{ id: 't1', name: 'Core', slug: 'core', role: 'MEMBER' }],
    lastUsedAt: null,
    ...over,
  };
}

function show(role: string) {
  api.orgs.mockResolvedValue([{ ...ORG, role }]);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/acme-labs/settings/service-accounts']}>
        <Routes>
          <Route path="/:org/settings/service-accounts" element={<ServiceAccounts />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ServiceAccounts', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    authUser.current = { id: 'u-viewer', isAdmin: false };
    api.members.mockResolvedValue([]);
  });

  it('lists each bot with its status, owners, teams and last activity, linked to its page', async () => {
    api.list.mockResolvedValue([bot({ lastUsedAt: new Date().toISOString() })]);
    show('ADMIN');
    const link = await screen.findByRole('link', { name: /Nightly Triage/ });
    expect(link).toHaveAttribute('href', '/acme-labs/settings/service-accounts/bot-1');
    const row = link.closest('tr') as HTMLElement;
    expect(within(row).getByText('Active')).toBeInTheDocument();
    expect(within(row).getByText('Jan Voorbeeld')).toBeInTheDocument();
    expect(within(row).getByText('Core')).toBeInTheDocument();
    expect(within(row).queryByText('Never')).toBeNull();
    expect(api.list).toHaveBeenCalledWith('org-1');
  });

  it('an orphaned bot shows "Suspended: no owner"', async () => {
    api.list.mockResolvedValue([
      bot({ status: 'SUSPENDED', suspendedReason: 'ORPHANED', owners: [] }),
    ]);
    show('ADMIN');
    expect(await screen.findByText('Suspended: no owner')).toBeInTheDocument();
  });

  it('a bot suspended by hand shows "Suspended"', async () => {
    api.list.mockResolvedValue([bot({ status: 'SUSPENDED', suspendedReason: 'MANUAL' })]);
    show('ADMIN');
    expect(await screen.findByText('Suspended')).toBeInTheDocument();
  });

  it('Review Focus 2: an owner who is not an admin sees only their bot, and no create button', async () => {
    api.list.mockResolvedValue([bot()]);
    show('MEMBER');
    expect(await screen.findByRole('link', { name: /Nightly Triage/ })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Nightly Triage|Summary/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /New service account/ })).toBeNull();
  });

  it('a member who owns no bot is told so, not shown an error', async () => {
    api.list.mockRejectedValue(new ApiError(403, 'Only an org owner or admin', 'FORBIDDEN'));
    show('MEMBER');
    expect(await screen.findByText('No service accounts for you here')).toBeInTheDocument();
  });

  it('an org admin creates a bot with owners picked from eligible members', async () => {
    api.list.mockResolvedValue([]);
    api.members.mockResolvedValue([
      {
        userId: 'u-jan',
        role: 'MEMBER',
        user: { id: 'u-jan', username: 'jan', displayName: 'Jan Voorbeeld' },
      },
      {
        userId: 'u-guest',
        role: 'GUEST',
        user: { id: 'u-guest', username: 'gast', displayName: 'Gast Voorbeeld' },
      },
    ]);
    api.create.mockResolvedValue(bot({ id: 'bot-new' }));
    show('ADMIN');

    fireEvent.click(await screen.findByRole('button', { name: /New service account/ }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'nightly-triage' } });
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Nightly Triage' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Triages the backlog' },
    });
    // A guest can't own a bot, so the picker leaves them out
    expect(await screen.findByLabelText(/Jan Voorbeeld/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Gast Voorbeeld/)).toBeNull();
    fireEvent.click(screen.getByLabelText(/Jan Voorbeeld/));
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith('org-1', {
        username: 'nightly-triage',
        displayName: 'Nightly Triage',
        description: 'Triages the backlog',
        ownerIds: ['u-jan'],
      }),
    );
  });

  it('create without an owner is not sent', async () => {
    api.list.mockResolvedValue([]);
    show('OWNER');
    fireEvent.click(await screen.findByRole('button', { name: /New service account/ }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'nightly-triage' } });
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Nightly' } });
    expect(screen.getByRole('button', { name: /^Create$/ })).toBeDisabled();
  });

  it('a refused create shows the reason in plain words', async () => {
    api.list.mockResolvedValue([]);
    api.members.mockResolvedValue([
      {
        userId: 'u-jan',
        role: 'MEMBER',
        user: { id: 'u-jan', username: 'jan', displayName: 'Jan Voorbeeld' },
      },
    ]);
    api.create.mockRejectedValue(new ApiError(409, 'Username already taken', 'USERNAME_TAKEN'));
    show('ADMIN');
    fireEvent.click(await screen.findByRole('button', { name: /New service account/ }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'taken' } });
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Taken' } });
    fireEvent.click(await screen.findByLabelText(/Jan Voorbeeld/));
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    expect(await screen.findByText('That username is taken.')).toBeInTheDocument();
  });
});
