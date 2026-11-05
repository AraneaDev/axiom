import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
