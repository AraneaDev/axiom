import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ status: vi.fn(), configure: vi.fn() }));

vi.mock('@/api/github.api', () => ({
  githubImportKey: (id: string) => ['github-import', id],
  githubImportApi: api,
}));

import { GithubImportSection } from './GithubImportSection';

function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <GithubImportSection projectId="p1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const run = (over: Record<string, unknown> = {}) => ({
  status: 'RUNNING',
  total: 10,
  done: 4,
  failed: 1,
  error: null,
  resumeAt: null,
  linkCommentsWaitUntil: null,
  ...over,
});

describe('GithubImportSection', () => {
  beforeEach(() => {
    api.status.mockReset();
    api.configure.mockReset();
    api.status.mockResolvedValue({ enabled: false, run: null, liveCap: null });
  });

  it('asks before switching import on, then sends it', async () => {
    api.configure.mockResolvedValue({ enabled: true, queued: true, run: run() });
    show();
    await userEvent.click(await screen.findByLabelText('Import GitHub Issues'));
    expect(api.configure).not.toHaveBeenCalled();
    expect(screen.getAllByText(/one comment/i).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Switch on' }));
    await waitFor(() => expect(api.configure).toHaveBeenCalledWith('p1', true));
  });

  it('switches import off without asking', async () => {
    api.status.mockResolvedValue({ enabled: true, run: run({ status: 'DONE' }), liveCap: null });
    api.configure.mockResolvedValue({ enabled: false, queued: false, run: null });
    show();
    await userEvent.click(await screen.findByLabelText('Import GitHub Issues'));
    await waitFor(() => expect(api.configure).toHaveBeenCalledWith('p1', false));
  });

  it('shows done of total and the failed count, clamped to the total', async () => {
    api.status.mockResolvedValue({
      enabled: true,
      run: run({ done: 14, total: 10, failed: 2 }),
      liveCap: null,
    });
    show();
    expect(await screen.findByText('10 of 10 imported, 2 failed')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('shows only the count without a bar while the total is unknown', async () => {
    api.status.mockResolvedValue({
      enabled: true,
      run: run({ total: null, done: 3 }),
      liveCap: null,
    });
    show();
    expect(await screen.findByText('3 imported, 1 failed')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('says when a paused import resumes, when link comments wait and when the live cap holds', async () => {
    api.status.mockResolvedValue({
      enabled: true,
      run: run({
        status: 'PAUSED',
        resumeAt: '2026-11-08T12:00:00Z',
        linkCommentsWaitUntil: '2026-11-08T13:00:00Z',
      }),
      liveCap: { paused: true, resumesAt: '2026-11-08T14:00:00Z' },
    });
    show();
    expect(await screen.findByText(/paused, resumes at/i)).toBeInTheDocument();
    expect(screen.getByText(/link comments wait until/i)).toBeInTheDocument();
    expect(screen.getByText(/live import paused until .* \(hourly limit\)/i)).toBeInTheDocument();
  });

  it('shows a failure as plain text and offers to switch import on again', async () => {
    api.status.mockResolvedValue({
      enabled: true,
      run: run({ status: 'FAILED', error: '<b>boom</b> **x**' }),
      liveCap: null,
    });
    api.configure.mockResolvedValue({ enabled: true, queued: true, run: run() });
    show();
    expect(await screen.findByText('<b>boom</b> **x**')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch import on again' }));
    await userEvent.click(screen.getByRole('button', { name: 'Switch on' }));
    await waitFor(() => expect(api.configure).toHaveBeenCalledWith('p1', true));
  });

  it('notes that nothing was queued when import was on already', async () => {
    api.status.mockResolvedValue({ enabled: false, run: null, liveCap: null });
    api.configure.mockResolvedValue({ enabled: true, queued: false, run: run({ status: 'DONE' }) });
    show();
    await userEvent.click(await screen.findByLabelText('Import GitHub Issues'));
    await userEvent.click(screen.getByRole('button', { name: 'Switch on' }));
    expect(await screen.findByText(/already on/i)).toBeInTheDocument();
  });
});
