import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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
const list = vi.hoisted(() => vi.fn());
const approve = vi.hoisted(() => vi.fn());
const reject = vi.hoisted(() => vi.fn());

vi.mock('@/api/agent-approvals.api', () => ({ agentApprovalsApi: { list, approve, reject } }));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { ApiError } from '@/api/client';

import AgentApprovals from './AgentApprovals';

const IN_AN_HOUR = new Date(Date.now() + 3_600_000).toISOString();
const AN_HOUR_AGO = new Date(Date.now() - 3_600_000).toISOString();

function row(over: Record<string, unknown>) {
  return {
    id: 'a1',
    action: 'issue.delete',
    preview: 'Delete issue AXM-1',
    status: 'PENDING',
    apiTokenName: 'ci-bot',
    channel: 'rest',
    decidedAt: null,
    expiresAt: IN_AN_HOUR,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AgentApprovals />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AgentApprovals', () => {
  beforeEach(() => {
    list.mockReset();
    approve.mockReset();
    reject.mockReset();
  });

  it('Review Focus 5: a bot request shows the bot with its marker and the owner line, and approve calls the action', async () => {
    list.mockResolvedValue({
      data: [
        row({
          id: 'b1',
          preview: 'Close issue AXM-7',
          serviceAccount: { id: 'bot-1', displayName: 'Triage bot' },
        }),
      ],
      total: 1,
    });
    approve.mockResolvedValue(row({ id: 'b1', status: 'EXECUTED' }));
    show();
    const link = await screen.findByRole('link', { name: 'Close issue AXM-7' });
    const cell = link.closest('tr') as HTMLElement;
    expect(within(cell).getByText('Triage bot')).toBeInTheDocument();
    expect(within(cell).getByText('bot')).toBeInTheDocument();
    expect(within(cell).getByText(/on behalf of nobody/i)).toBeInTheDocument();
    expect(within(cell).getByText(/You own this bot/)).toBeInTheDocument();
    fireEvent.click(within(cell).getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith('b1'));
  });

  it('rejects from the list', async () => {
    list.mockResolvedValue({ data: [row({})], total: 1 });
    reject.mockResolvedValue(row({ status: 'REJECTED' }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Reject/ }));
    await waitFor(() => expect(reject).toHaveBeenCalledWith('a1'));
  });

  it('a request in a place the owner cannot open is a stub, with no link and no decision', async () => {
    list.mockResolvedValue({
      data: [
        row({
          id: 'r1',
          preview: 'A request in a place you cannot open',
          restricted: true,
          serviceAccount: { id: 'bot-1', displayName: 'Triage bot' },
        }),
      ],
      total: 1,
    });
    show();
    const stub = await screen.findByText("A request in a place you can't open");
    const cell = stub.closest('tr') as HTMLElement;
    expect(within(cell).queryByRole('link')).toBeNull();
    expect(within(cell).queryByRole('button', { name: /Approve|Reject/ })).toBeNull();
    expect(within(cell).getByText('Triage bot')).toBeInTheDocument();
  });

  it('says in plain words why a decision was refused', async () => {
    list.mockResolvedValue({ data: [row({})], total: 1 });
    approve.mockRejectedValue(new ApiError(403, 'ui only', 'UI_ONLY'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Approve/ }));
    expect(await screen.findByText(/only be done in the web UI/)).toBeInTheDocument();
  });

  it('lists pending requests and links each to its detail', async () => {
    list.mockResolvedValue({ data: [row({})], total: 1 });
    show();
    const link = await screen.findByRole('link', { name: 'Delete issue AXM-1' });
    expect(link).toHaveAttribute('href', '/approvals/agent/a1');
    expect(list).toHaveBeenCalledWith({ status: 'PENDING' });
  });

  it('does not show a request past its expiry as pending, whatever the row says', async () => {
    list.mockResolvedValue({ data: [row({ expiresAt: AN_HOUR_AGO })], total: 1 });
    show();
    expect(await screen.findByText('Nothing waits for you')).toBeInTheDocument();
  });

  it('shows an expired request in the history with the status Expired', async () => {
    list.mockResolvedValue({
      data: [
        row({ expiresAt: AN_HOUR_AGO }),
        row({ id: 'a2', status: 'EXECUTED', preview: 'Done' }),
      ],
      total: 2,
    });
    show();
    fireEvent.click(await screen.findByRole('tab', { name: /history/i }));
    expect(await screen.findByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('Executed')).toBeInTheDocument();
  });

  it('shows the preview as text, never as markup', async () => {
    list.mockResolvedValue({ data: [row({ preview: 'Delete <b>bold</b> **x**' })], total: 1 });
    show();
    expect(await screen.findByText('Delete <b>bold</b> **x**')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });

  it('asks for the decided requests a page at a time, so older ones are reachable', async () => {
    list.mockResolvedValue({
      data: [row({ id: 'a2', status: 'EXECUTED', preview: 'Done' })],
      total: 60,
    });
    show();
    fireEvent.click(await screen.findByRole('tab', { name: /history/i }));
    await screen.findByText('Done');
    expect(list).toHaveBeenLastCalledWith({ state: 'decided', limit: 25, offset: 0 });
    fireEvent.click(screen.getByTitle('Next page'));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ state: 'decided', limit: 25, offset: 25 }),
    );
  });

  it("shows a skeleton, not the other tab's rows or an empty state, while the history loads", async () => {
    list.mockImplementation((args?: { state?: string }) =>
      args?.state === 'decided'
        ? new Promise(() => {})
        : Promise.resolve({ data: [row({})], total: 1 }),
    );
    show();
    await screen.findByText('Delete issue AXM-1');
    fireEvent.click(screen.getByRole('tab', { name: /history/i }));
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ state: 'decided' })),
    );
    expect(screen.queryByText('No decided requests yet')).toBeNull();
    expect(screen.queryByText('Delete issue AXM-1')).toBeNull();
  });
});
