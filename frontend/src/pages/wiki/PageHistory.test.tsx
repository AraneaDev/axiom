import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ToastProvider } from '@/components/ui/Toast';

const mockGetPageHistory = vi.fn();
const mockGetPage = vi.fn();

vi.mock('@/api/wiki.api', () => ({
  wikiApi: {
    getPageHistory: (...args: unknown[]) => mockGetPageHistory(...args),
    getPage: (...args: unknown[]) => mockGetPage(...args),
    restoreVersion: vi.fn(),
  },
}));

vi.mock('./WikiLayout', () => ({
  useWikiContext: () => ({ currentSpace: { id: 's1' } }),
}));

import PageHistory from './PageHistory';

const author = { id: 'u1', username: 'tim', displayName: 'Tim' };
const version = (n: number, kind: string, body = `body ${n}`) => ({
  id: `v${n}`,
  version: n,
  title: 'Page',
  body,
  author,
  kind,
  createdAt: '2026-10-29T10:00:00.000Z',
});

function renderHistory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/aranea/axiom/wiki/docs/page/history']}>
          <Routes>
            <Route path="/:org/:team/wiki/:space/:page/history" element={<PageHistory />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('PageHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows kind badges', async () => {
    mockGetPageHistory.mockResolvedValue([
      version(5, 'MERGE'),
      version(4, 'SESSION_DRAFT'),
      version(3, 'RESTORE'),
      version(2, 'EXTERNAL'),
      version(1, 'EDIT'),
    ]);
    mockGetPage.mockResolvedValue({ id: 'p1', title: 'Page', body: 'body 5' });
    renderHistory();
    const badge = { selector: '[data-kind]' };
    expect(await screen.findByText('Merge', badge)).toHaveAttribute('data-kind', 'MERGE');
    expect(screen.getByText('Session draft', badge)).toHaveAttribute('data-kind', 'SESSION_DRAFT');
    expect(screen.getByText('Restore', badge)).toHaveAttribute('data-kind', 'RESTORE');
    expect(screen.getByText('Agent/API', badge)).toHaveAttribute('data-kind', 'EXTERNAL');
    expect(screen.getByText('Edit', badge)).toHaveAttribute('data-kind', 'EDIT');
  });

  it('offers restore for every version except the current page body', async () => {
    // The newest version is a session draft; the page head is the agent's version 2
    mockGetPageHistory.mockResolvedValue([
      version(3, 'SESSION_DRAFT', 'draft'),
      version(2, 'EXTERNAL', 'agent'),
      version(1, 'EDIT', 'original'),
    ]);
    mockGetPage.mockResolvedValue({ id: 'p1', title: 'Page', body: 'agent' });
    renderHistory();
    expect(await screen.findByTitle('Restore to version 3')).toBeInTheDocument();
    expect(screen.getByTitle('Restore to version 1')).toBeInTheDocument();
    expect(screen.queryByTitle('Restore to version 2')).not.toBeInTheDocument();
  });
});
