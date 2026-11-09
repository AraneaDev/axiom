import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
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
const get = vi.hoisted(() => vi.fn());
const approve = vi.hoisted(() => vi.fn());
const reject = vi.hoisted(() => vi.fn());

vi.mock('@/api/agent-approvals.api', () => ({ agentApprovalsApi: { get, approve, reject } }));

import { ToastProvider } from '@/components/ui/Toast';

import AgentApprovalDetail from './AgentApprovalDetail';

const IN_AN_HOUR = new Date(Date.now() + 3_600_000).toISOString();

function request(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    userId: 'u1',
    action: 'issue.delete',
    preview: 'Delete issue AXM-1',
    status: 'PENDING',
    apiTokenName: 'ci-bot',
    channel: 'rest',
    input: { key: 'AXM-1' },
    result: null,
    error: null,
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
      <ToastProvider>
        <MemoryRouter initialEntries={['/approvals/agent/a1']}>
          <Link to="/approvals/agent/b2">Go to b2</Link>
          <Routes>
            <Route path="/approvals/agent/:id" element={<AgentApprovalDetail />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('AgentApprovalDetail', () => {
  beforeEach(() => {
    get.mockReset();
    approve.mockReset();
    reject.mockReset();
  });

  it('shows who asked, the preview as text and the input only once opened', async () => {
    get.mockResolvedValue(request({ preview: 'Delete <i>one</i>' }));
    show();
    expect(await screen.findByText('Delete <i>one</i>')).toBeInTheDocument();
    expect(document.querySelector('i')).toBeNull();
    expect(screen.getByText(/through the token ci-bot/)).toBeInTheDocument();
    expect(screen.queryByText(/"key": "AXM-1"/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /show input/i }));
    expect(screen.getByText(/"key": "AXM-1"/)).toBeInTheDocument();
  });

  it("names a bot's request by the bot, with its marker, on behalf of nobody", async () => {
    get.mockResolvedValue(
      request({ userId: 'bot-1', serviceAccount: { id: 'bot-1', displayName: 'Triage bot' } }),
    );
    show();
    expect(await screen.findByText('Triage bot')).toBeInTheDocument();
    expect(screen.getByText('bot')).toBeInTheDocument();
    expect(screen.getByText(/You own this bot/)).toBeInTheDocument();
    expect(screen.queryByText(/^You, through/)).toBeNull();
  });

  it('I2: a request in a place you cannot open shows only the stub: no input, no decision', async () => {
    get.mockResolvedValue(
      request({
        userId: 'bot-1',
        preview: 'A request in a place you cannot open',
        restricted: true,
        input: undefined,
        serviceAccount: { id: 'bot-1', displayName: 'Triage bot' },
      }),
    );
    show();
    expect(await screen.findByText("A request in a place you can't open")).toBeInTheDocument();
    expect(screen.getByText('Triage bot')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reject/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /show input/i })).toBeNull();
  });

  it.each([
    ['REJECTED', /This request was rejected/, /You rejected/],
    ['EXECUTED', /This request ran/, /returned nothing/],
    ['FAILED', /This request failed/, /failed without a message/],
  ])(
    'a decided stub (%s) states the outcome neutrally and shows no result or error',
    async (status, shown, hidden) => {
      get.mockResolvedValue(
        request({
          userId: 'bot-1',
          status,
          restricted: true,
          input: undefined,
          result: undefined,
          error: undefined,
          serviceAccount: { id: 'bot-1', displayName: 'Triage bot' },
        }),
      );
      show();
      expect(await screen.findByText(shown)).toBeInTheDocument();
      expect(screen.queryByText(hidden)).toBeNull();
      expect(screen.queryByText('Result')).toBeNull();
    },
  );

  it('approves, then shows the result', async () => {
    get.mockResolvedValue(request());
    approve.mockResolvedValue(request({ status: 'EXECUTED', result: { deleted: true } }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
    expect(await screen.findByText(/"deleted": true/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    expect(approve).toHaveBeenCalledWith('a1');
  });

  it('shows the failure of an approved run', async () => {
    get.mockResolvedValue(request());
    approve.mockResolvedValue(
      request({
        status: 'FAILED',
        error: { code: 'TOKEN_REVOKED', message: 'The token was revoked' },
      }),
    );
    show();
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
    expect(await screen.findByText('The token was revoked')).toBeInTheDocument();
  });

  it('does not toast Approved for a run that ended FAILED', async () => {
    get.mockResolvedValue(request());
    approve.mockResolvedValue(
      request({ status: 'FAILED', error: { code: 'X', message: 'The token was revoked' } }),
    );
    show();
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
    await screen.findByText('The token was revoked');
    expect(screen.queryByText('Approved')).toBeNull();
    expect(screen.getByText('Approved, but the action failed')).toBeInTheDocument();
  });

  it('shows the raw token of a token create once, from the approve answer', async () => {
    get.mockResolvedValue(request({ action: 'token.create' }));
    approve.mockResolvedValue(
      request({ status: 'EXECUTED', result: { id: 't1', token: 'axm_secret_value' } }),
    );
    show();
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
    const field = await screen.findByLabelText('New token');
    expect(field).toHaveValue('axm_secret_value');
    expect(screen.getByText(/not stored/)).toBeInTheDocument();
    // The result block does not repeat it
    expect(screen.queryByText(/axm_secret_value/)).toBeNull();
  });

  it('does not call an invitation result a new API token', async () => {
    get.mockResolvedValue(request({ action: 'invitation.create' }));
    approve.mockResolvedValue(
      request({ status: 'EXECUTED', result: { id: 'i1', token: 'invite_value' } }),
    );
    show();
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
    expect(await screen.findByText('Executed')).toBeInTheDocument();
    expect(screen.queryByLabelText('New token')).toBeNull();
  });

  it('rejects', async () => {
    get.mockResolvedValue(request());
    reject.mockResolvedValue(request({ status: 'REJECTED' }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: /reject/i }));
    expect(await screen.findByText(/action never ran/)).toBeInTheDocument();
  });

  it('offers no decision on a request past its expiry', async () => {
    get.mockResolvedValue(request({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    show();
    expect(await screen.findByText(/expired before you decided/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
  });

  it('says why a decision failed, such as a request that expired meanwhile', async () => {
    get.mockResolvedValue(request());
    approve.mockRejectedValue(new Error('This request is no longer waiting'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('This request is no longer waiting'),
    );
  });

  it('shows the next request, not the one decided before, after in-app navigation', async () => {
    get.mockImplementation(async (id: string) =>
      id === 'a1'
        ? request()
        : request({ id: 'b2', preview: 'Delete issue AXM-2', input: { key: 'AXM-2' } }),
    );
    approve.mockResolvedValue(request({ status: 'EXECUTED', result: { deleted: true } }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
    expect(await screen.findByText(/"deleted": true/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Go to b2'));
    expect(await screen.findByText('Delete issue AXM-2')).toBeInTheDocument();
    expect(screen.queryByText(/"deleted": true/)).toBeNull();
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
  });

  it('does not show the failed decision of one request on the next', async () => {
    get.mockImplementation(async (id: string) =>
      id === 'a1' ? request() : request({ id: 'b2', preview: 'Delete issue AXM-2' }),
    );
    approve.mockRejectedValue(new Error('This request is no longer waiting'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByText('Go to b2'));
    expect(await screen.findByText('Delete issue AXM-2')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows when a request expires with the time, and the time left while open', async () => {
    const at = new Date(Date.now() + 600_000);
    get.mockResolvedValue(request({ expiresAt: at.toISOString() }));
    show();
    const label = await screen.findByText('Expires');
    const value = label.nextElementSibling as HTMLElement;
    expect(value.textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(value.textContent).toMatch(/left/);
  });

  it('does not label a decided request Expired', async () => {
    get.mockResolvedValue(request({ status: 'EXECUTED', decidedAt: new Date().toISOString() }));
    show();
    await screen.findByText('Delete issue AXM-1');
    expect(screen.queryByText('Expired')).toBeNull();
    expect(screen.queryByText('Expires')).toBeNull();
  });

  it('shows the row instead of an error when another decision got there first', async () => {
    get.mockResolvedValueOnce(request());
    get.mockResolvedValue(request({ status: 'REJECTED', decidedAt: new Date().toISOString() }));
    const conflict = Object.assign(new Error('This request is rejected'), { status: 409 });
    approve.mockRejectedValue(conflict);
    show();
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
    expect(await screen.findByText(/You rejected this request/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
