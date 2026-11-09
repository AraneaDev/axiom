import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  get: vi.fn(),
  createToken: vi.fn(),
  rotateToken: vi.fn(),
  revokeToken: vi.fn(),
}));

vi.mock('@/api/service-accounts.api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/api/service-accounts.api')>();
  return {
    ...real,
    serviceAccountsApi: {
      get: api.get,
      createToken: api.createToken,
      rotateToken: api.rotateToken,
      revokeToken: api.revokeToken,
    },
  };
});
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { ApiError } from '@/api/client';
import type { ServiceAccountDetail } from '@/api/service-accounts.api';

import { ServiceAccountTokens } from './ServiceAccountTokens';

const NOW = new Date('2026-11-09T12:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const RAW = 'axm_rawSecretValue0123456789';

function token(over: Record<string, unknown> = {}) {
  return {
    id: 'tok-1',
    name: 'nightly',
    prefix: 'axm_abc123',
    scopes: ['issues:read', 'wiki:write'],
    expiresAt: new Date(NOW + 60 * DAY).toISOString(),
    rotatedAt: null,
    lastUsedAt: null,
    createdAt: '2026-11-01T00:00:00Z',
    ...over,
  };
}

function bot(over: Record<string, unknown> = {}): ServiceAccountDetail {
  return {
    id: 'bot-1',
    orgId: 'org-1',
    username: 'nightly-triage',
    displayName: 'Nightly Triage',
    avatarUrl: null,
    description: '',
    status: 'ACTIVE',
    suspendedReason: null,
    suspendedAt: null,
    createdById: null,
    createdAt: '2026-11-01T00:00:00Z',
    owners: [],
    teams: [],
    spaces: [],
    tokens: [token()],
    ...over,
  } as ServiceAccountDetail;
}

/** The panel as the bot's page holds it: fed by the bot's query, which a change refetches */
function Harness() {
  const { data } = useQuery({ queryKey: ['service-account', 'bot-1'], queryFn: () => api.get() });
  return data ? <ServiceAccountTokens bot={data} /> : null;
}

function show(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

/**
 * Whether any mutation the client still holds carries this value
 * @param client
 * @param value
 */
function cachedAnywhere(client: QueryClient, value: string) {
  return client
    .getMutationCache()
    .getAll()
    .some((m) => JSON.stringify(m.state.data ?? null).includes(value));
}

describe('ServiceAccountTokens', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => vi.restoreAllMocks());

  it('lists each token by name, prefix, scopes, expiry and last use, never more than the prefix', async () => {
    api.get.mockResolvedValue(
      bot({
        tokens: [
          token({ lastUsedAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() }),
          token({
            id: 'tok-2',
            name: 'soon',
            prefix: 'axm_soon00',
            expiresAt: new Date(NOW + 5 * DAY).toISOString(),
          }),
        ],
      }),
    );
    show();
    const first = await screen.findByTestId('token-tok-1');
    expect(within(first).getByText('nightly')).toBeInTheDocument();
    expect(within(first).getByText(/axm_abc123/)).toBeInTheDocument();
    expect(within(first).getByText(/issues:read/)).toBeInTheDocument();
    expect(within(first).getByText(/wiki:write/)).toBeInTheDocument();
    expect(within(first).getByText(/Last used/)).toBeInTheDocument();
    // Within 14 days of its end, the expiry warns
    const soon = within(screen.getByTestId('token-tok-2')).getByText(/Expires/);
    expect(soon.className).toMatch(/text-warning/);
    expect(within(first).getByText(/Expires/).className).not.toMatch(/text-warning/);
    expect(within(screen.getByTestId('token-tok-2')).getByText(/Never used/)).toBeInTheDocument();
  });

  it('the expiry options offer nothing above 365 days, and 90 is the default', async () => {
    api.get.mockResolvedValue(bot());
    show();
    fireEvent.click(await screen.findByRole('button', { name: /New token/ }));
    const dialog = await screen.findByRole('dialog');
    const trigger = within(dialog).getByRole('button', { name: /Expires in/ });
    expect(trigger).toHaveTextContent('90 days');
    fireEvent.click(trigger);
    const offered = within(dialog)
      .getAllByRole('button', { name: /^\d+ days$/ })
      .map((b) => b.textContent);
    expect([...new Set(offered)].sort((a, b) => parseInt(a!) - parseInt(b!))).toEqual([
      '30 days',
      '90 days',
      '180 days',
      '365 days',
    ]);
    // No admin scope is offered to a bot
    expect(within(dialog).queryByRole('switch', { name: /Admin/ })).toBeNull();
    expect(within(dialog).queryByLabelText(/Admin write/)).toBeNull();
  });

  it('create shows the token once with the Claude Code and Codex snippets filled in; Review Focus 3: after the refetch and a reload only the prefix shows', async () => {
    const created = token({ id: 'tok-new', name: 'triage', prefix: 'axm_rawSec' });
    api.get.mockResolvedValueOnce(bot()).mockResolvedValue(bot({ tokens: [token(), created] }));
    api.createToken.mockResolvedValue({ ...created, token: RAW });
    const view = show();

    fireEvent.click(await screen.findByRole('button', { name: /New token/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Token name'), {
      target: { value: 'triage' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Create token/ }));

    await waitFor(() =>
      expect(api.createToken).toHaveBeenCalledWith(
        'bot-1',
        expect.objectContaining({ name: 'triage', expiresInDays: 90 }),
      ),
    );
    const sent = api.createToken.mock.calls[0][1] as { scopes: string[] };
    expect(sent.scopes.length).toBeGreaterThan(0);
    expect(sent.scopes.some((s) => s.startsWith('admin:'))).toBe(false);

    const shown = await screen.findByTestId('new-token');
    expect(within(shown).getByLabelText('token')).toHaveValue(RAW);
    expect(within(shown).getByText(/won't see it again/)).toBeInTheDocument();
    const values = within(shown)
      .getAllByRole('textbox')
      .map((el) => (el as HTMLInputElement | HTMLTextAreaElement).value);
    expect(values.some((v) => v.startsWith('claude mcp add') && v.includes(`Token ${RAW}`))).toBe(
      true,
    );
    expect(
      values.some(
        (v) => v.includes('[mcp_servers.axiom-nightly-triage]') && v.includes(`Token ${RAW}`),
      ),
    ).toBe(true);
    expect(within(shown).getAllByRole('button', { name: /Copy/i }).length).toBeGreaterThan(0);

    // The bot's query refetched: the list holds the new token by its prefix only
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    const row = await screen.findByTestId('token-tok-new');
    expect(within(row).getByText(/axm_rawSec/)).toBeInTheDocument();
    expect(row.textContent).not.toContain(RAW);

    // Done hides it for good
    fireEvent.click(within(shown).getByRole('button', { name: /Done/ }));
    expect(screen.queryByTestId('new-token')).toBeNull();
    expect(document.body.innerHTML).not.toContain(RAW);

    // A reload starts without it: only the prefix shows
    view.unmount();
    show();
    expect(await screen.findByTestId('token-tok-new')).toBeInTheDocument();
    expect(screen.queryByTestId('new-token')).toBeNull();
    expect(document.body.innerHTML).not.toContain(RAW);
  });

  it("names the MCP server after the bot, so it sits beside a person's own axiom server", async () => {
    api.get.mockResolvedValue(bot());
    api.createToken.mockResolvedValue({ ...token({ id: 'tok-n' }), token: RAW });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /New token/ }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: /Create token/ }),
    );
    const shown = await screen.findByTestId('new-token');
    const values = within(shown)
      .getAllByRole('textbox')
      .map((el) => (el as HTMLInputElement | HTMLTextAreaElement).value);
    expect(
      values.some((v) => v.startsWith('claude mcp add --transport http axiom-nightly-triage ')),
    ).toBe(true);
    expect(values.some((v) => v.startsWith('[mcp_servers.axiom-nightly-triage]'))).toBe(true);
  });

  it('M1: once the panel is done, no mutation holds the raw token', async () => {
    api.get.mockResolvedValue(bot());
    api.createToken.mockResolvedValue({ ...token({ id: 'tok-n' }), token: RAW });
    api.rotateToken.mockResolvedValue({ ...token({ id: 'tok-r' }), token: `${RAW}rot` });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    show(client);
    fireEvent.click(await screen.findByRole('button', { name: /New token/ }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: /Create token/ }),
    );
    fireEvent.click(
      within(await screen.findByTestId('new-token')).getByRole('button', { name: /Done/ }),
    );
    await waitFor(() => expect(cachedAnywhere(client, RAW)).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: /Rotate nightly/ }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: /Rotate/ }),
    );
    fireEvent.click(
      within(await screen.findByTestId('new-token')).getByRole('button', { name: /Done/ }),
    );
    await waitFor(() => expect(cachedAnywhere(client, `${RAW}rot`)).toBe(false));
  });

  it('rotate says the old token works for 7 more days, then shows the new one once', async () => {
    api.get.mockResolvedValue(bot());
    api.rotateToken.mockResolvedValue({
      ...token({ id: 'tok-3', prefix: 'axm_rot000' }),
      token: RAW,
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Rotate nightly/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/7 more days/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /Rotate/ }));
    await waitFor(() => expect(api.rotateToken).toHaveBeenCalledWith('bot-1', 'tok-1'));
    const shown = await screen.findByTestId('new-token');
    expect(within(shown).getByLabelText('token')).toHaveValue(RAW);
    // A rotation says so, not that a token was created
    expect(within(shown).getByText(/rotated/)).toBeInTheDocument();
    expect(within(shown).queryByText(/created/)).toBeNull();
  });

  it('a token rotated before offers no rotate, and a second rotation in a race says so in plain words', async () => {
    api.get.mockResolvedValue(
      bot({
        tokens: [token({ id: 'tok-old', name: 'old', rotatedAt: '2026-11-08T00:00:00Z' }), token()],
      }),
    );
    api.rotateToken.mockRejectedValue(
      new ApiError(409, 'This token was already rotated', 'TOKEN_ALREADY_ROTATED'),
    );
    show();
    const old = await screen.findByTestId('token-tok-old');
    expect(within(old).queryByRole('button', { name: /Rotate/ })).toBeNull();
    expect(within(old).getByText(/Rotated/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Rotate nightly/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Rotate/ }));
    expect(await screen.findByText(/already rotated\. Rotate its replacement/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('revoke asks first, then calls the action', async () => {
    api.get.mockResolvedValue(bot());
    api.revokeToken.mockResolvedValue(undefined);
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Revoke nightly/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/stops working at once/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /Revoke/ }));
    await waitFor(() => expect(api.revokeToken).toHaveBeenCalledWith('bot-1', 'tok-1'));
  });

  it('a suspended bot gets no new or rotated token', async () => {
    api.get.mockResolvedValue(bot({ status: 'SUSPENDED', suspendedReason: 'MANUAL' }));
    show();
    expect(await screen.findByRole('button', { name: /New token/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Rotate nightly/ })).toBeDisabled();
  });
});
