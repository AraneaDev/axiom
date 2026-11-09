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
  get: vi.fn(),
  activity: vi.fn(),
  update: vi.fn(),
  setOwners: vi.fn(),
  suspend: vi.fn(),
  resume: vi.fn(),
  delete: vi.fn(),
  approvals: vi.fn(),
}));
const authUser = vi.hoisted(() => ({ current: { id: 'u-admin', isAdmin: false } }));

vi.mock('@/api/orgs.api', () => ({
  orgsApi: { list: api.orgs, listMembers: api.members },
}));
vi.mock('@/api/agent-approvals.api', () => ({ agentApprovalsApi: { list: api.approvals } }));
vi.mock('@/api/service-accounts.api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/api/service-accounts.api')>();
  return {
    ...real,
    serviceAccountsApi: {
      get: api.get,
      activity: api.activity,
      update: api.update,
      setOwners: api.setOwners,
      suspend: api.suspend,
      resume: api.resume,
      delete: api.delete,
    },
  };
});
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (pick?: (s: { user: typeof authUser.current }) => unknown) =>
    pick ? pick({ user: authUser.current }) : { user: authUser.current },
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { ApiError } from '@/api/client';

import ServiceAccountDetail from './ServiceAccountDetail';

const ORG = { id: 'org-1', slug: 'acme-labs', name: 'Acme Labs' };
const JAN = { id: 'u-jan', username: 'jan', displayName: 'Jan Voorbeeld' };
const PIM = { id: 'u-pim', username: 'pim', displayName: 'Pim Voorbeeld' };

function detail(over: Record<string, unknown> = {}) {
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
    owners: [JAN, PIM],
    teams: [{ id: 't1', name: 'Core', slug: 'core', role: 'MEMBER' }],
    spaces: [{ id: 's1', name: 'Handbook', slug: 'handbook', level: 'EDIT' }],
    tokens: [
      {
        id: 'tok-1',
        name: 'nightly',
        prefix: 'axm_abc123',
        scopes: ['issues:read'],
        expiresAt: '2027-01-01T00:00:00Z',
        rotatedAt: null,
        lastUsedAt: null,
        createdAt: '2026-11-01T00:00:00Z',
      },
    ],
    ...over,
  };
}

function show(role = 'ADMIN') {
  api.orgs.mockResolvedValue([{ ...ORG, role }]);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/acme-labs/settings/service-accounts/bot-1']}>
        <Routes>
          <Route path="/:org/settings/service-accounts/:id" element={<ServiceAccountDetail />} />
          <Route path="/:org/settings/service-accounts" element={<p>The list</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function member(user: typeof JAN, role = 'MEMBER') {
  return { userId: user.id, role, user };
}

describe('ServiceAccountDetail', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    authUser.current = { id: 'u-admin', isAdmin: false };
    api.activity.mockResolvedValue([]);
    api.approvals.mockResolvedValue({ data: [], total: 0 });
    api.members.mockResolvedValue([member(JAN), member(PIM)]);
  });

  it('shows the description, owners, memberships linked to each team, and tokens by prefix', async () => {
    api.get.mockResolvedValue(detail());
    show();
    expect(await screen.findByText('Triages the backlog every night')).toBeInTheDocument();
    expect(screen.getByText('Jan Voorbeeld')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Core/ })).toHaveAttribute(
      'href',
      '/acme-labs/core/members',
    );
    expect(screen.getByText('Handbook')).toBeInTheDocument();
    expect(screen.getByText(/axm_abc123/)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('bot-1');
  });

  it("shows the bot's recent activity, linked to what it touched", async () => {
    api.get.mockResolvedValue(detail());
    api.activity.mockResolvedValue([
      {
        id: 'a1',
        resourceType: 'issue',
        resourceId: 'i1',
        action: 'created',
        userId: 'bot-1',
        user: { id: 'bot-1', username: 'nightly-triage', displayName: 'Nightly Triage' },
        details: null,
        via: 'nightly',
        createdAt: new Date().toISOString(),
        resourceTitle: 'Stale ticket',
        resourceKey: 'AXM-1',
        resourceLink: '/acme-labs/core/axiom/issues/1',
      },
    ]);
    show();
    const link = await screen.findByRole('link', { name: /AXM-1/ });
    expect(link).toHaveAttribute('href', '/acme-labs/core/axiom/issues/1');
    expect(api.activity).toHaveBeenCalledWith('bot-1');
  });

  it('lists its waiting requests, each linked to its approval', async () => {
    api.get.mockResolvedValue(detail());
    api.approvals.mockResolvedValue({
      data: [
        {
          id: 'req-1',
          preview: 'Delete issue AXM-1',
          serviceAccount: { id: 'bot-1', displayName: 'Nightly Triage' },
        },
        { id: 'req-2', preview: 'Another bot', serviceAccount: { id: 'bot-2' } },
      ],
      total: 2,
    });
    show();
    const link = await screen.findByRole('link', { name: /Delete issue AXM-1/ });
    expect(link).toHaveAttribute('href', '/approvals/agent/req-1');
    expect(screen.queryByText('Another bot')).toBeNull();
    expect(api.approvals).toHaveBeenCalledWith({ state: 'open' });
  });

  it('Review Focus 1: an orphaned bot shows its state, disables the token actions and offers "Add an owner"', async () => {
    api.get.mockResolvedValue(
      detail({ status: 'SUSPENDED', suspendedReason: 'ORPHANED', owners: [] }),
    );
    show();
    expect(await screen.findByText('Suspended: no owner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New token/ })).toBeDisabled();
    // Resume refuses an orphan: a new owner is what resumes it
    expect(screen.queryByRole('button', { name: /Resume/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Add an owner/ }));
    fireEvent.click(await screen.findByLabelText(/Jan Voorbeeld/));
    api.setOwners.mockResolvedValue(detail({ owners: [JAN] }));
    fireEvent.click(screen.getByRole('button', { name: /Save owners/ }));
    await waitFor(() => expect(api.setOwners).toHaveBeenCalledWith('bot-1', ['u-jan']));
  });

  it('Review Focus 4: OWNER_NEEDED shows its reason, and the owners stay as they were', async () => {
    api.get.mockResolvedValue(detail());
    api.setOwners.mockRejectedValue(
      new ApiError(400, 'A place would have no owner', 'SERVICE_ACCOUNT_OWNER_NEEDED'),
    );
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Edit owners/ }));
    fireEvent.click(await screen.findByLabelText(/Pim Voorbeeld/));
    fireEvent.click(screen.getByRole('button', { name: /Save owners/ }));

    expect(
      await screen.findByText(/needs an owner who can open it/, { selector: '[role="alert"]' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.setOwners).toHaveBeenCalledWith('bot-1', ['u-jan']));
    const owners = screen.getByTestId('owners');
    expect(within(owners).getByText('Jan Voorbeeld')).toBeInTheDocument();
    expect(within(owners).getByText('Pim Voorbeeld')).toBeInTheDocument();
  });

  it('an org admin edits the description', async () => {
    api.get.mockResolvedValue(detail());
    api.update.mockResolvedValue(detail({ description: 'Closes stale tickets' }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Edit description/ }));
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Closes stale tickets' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save description/ }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith('bot-1', { description: 'Closes stale tickets' }),
    );
  });

  it('suspend asks first, then calls the action', async () => {
    api.get.mockResolvedValue(detail());
    api.suspend.mockResolvedValue(detail({ status: 'SUSPENDED', suspendedReason: 'MANUAL' }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^Suspend$/ }));
    expect(api.suspend).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Suspend/ }));
    await waitFor(() => expect(api.suspend).toHaveBeenCalledWith('bot-1'));
  });

  it('resume asks first, then calls the action', async () => {
    api.get.mockResolvedValue(detail({ status: 'SUSPENDED', suspendedReason: 'MANUAL' }));
    api.resume.mockResolvedValue(detail());
    show();
    expect(await screen.findByText('Suspended')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Resume$/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Resume/ }));
    await waitFor(() => expect(api.resume).toHaveBeenCalledWith('bot-1'));
  });

  it('delete names what goes, then calls the action and returns to the list', async () => {
    api.get.mockResolvedValue(detail());
    api.delete.mockResolvedValue(undefined);
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^Delete$/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/1 token/)).toBeInTheDocument();
    expect(within(dialog).getByText(/1 team/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('bot-1'));
    expect(await screen.findByText('The list')).toBeInTheDocument();
  });

  it('an owner who is no org admin can suspend, but not edit, set owners or delete', async () => {
    authUser.current = { id: 'u-jan', isAdmin: false };
    api.get.mockResolvedValue(detail());
    show('MEMBER');
    expect(await screen.findByRole('button', { name: /^Suspend$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit description/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit owners/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete$/ })).toBeNull();
    expect(api.members).not.toHaveBeenCalled();
  });

  it('a bot you cannot see shows as not found', async () => {
    api.get.mockRejectedValue(new ApiError(404, 'Not found', 'SERVICE_ACCOUNT_NOT_FOUND'));
    show();
    expect(
      await screen.findByText('This service account does not exist, or you cannot see it.'),
    ).toBeInTheDocument();
  });
});
