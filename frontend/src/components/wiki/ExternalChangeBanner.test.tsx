import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ToastProvider } from '@/components/ui/Toast';
import type { PendingChange } from '@/hooks/collab-messages';

const mockGetPendingMerge = vi.fn();
const mockApplyMerge = vi.fn();

vi.mock('@/api/wiki.api', () => ({
  wikiApi: {
    getPendingMerge: (...args: unknown[]) => mockGetPendingMerge(...args),
    applyMerge: (...args: unknown[]) => mockApplyMerge(...args),
  },
}));

import { ExternalChangeBanner } from './ExternalChangeBanner';

const recent = new Date(Date.now() - 5 * 60_000).toISOString();

const change: PendingChange = {
  externalVersionId: 'ext-1',
  authorName: 'Agent Smith',
  at: recent,
  kind: 'EXTERNAL',
};

const base = 'one\n\ntwo\n\nthree\n\nfour';

function pendingMerge(ours: string, theirs: string) {
  return {
    base,
    ours,
    theirs,
    oursLabel: 'Yours',
    theirsLabel: 'Agent Smith',
    externalVersionId: 'ext-1',
    authorName: 'Agent Smith',
    at: recent,
  };
}

function renderBanner(props: Partial<Parameters<typeof ExternalChangeBanner>[0]> = {}) {
  const onOpenConflicts = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ExternalChangeBanner
          spaceId="s1"
          pageSlug="page"
          pendingChange={change}
          resolvedBy={null}
          canEdit
          onOpenConflicts={onOpenConflicts}
          {...props}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onOpenConflicts };
}

describe('ExternalChangeBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows author and counts', async () => {
    // Theirs changes blocks one and four (clean) and two (overlaps ours)
    mockGetPendingMerge.mockResolvedValue(
      pendingMerge('one\n\nOURS\n\nthree\n\nfour', 'ONE\n\nTHEIRS\n\nthree\n\nFOUR'),
    );
    renderBanner();
    expect(screen.getByText(/Agent Smith updated this page 5m ago/)).toBeInTheDocument();
    expect(
      await screen.findByText('2 changes merge cleanly, 1 overlaps with yours'),
    ).toBeInTheDocument();
    expect(mockGetPendingMerge).toHaveBeenCalledWith('s1', 'page');
  });

  it('names the restored version for a restore', async () => {
    mockGetPendingMerge.mockResolvedValue(pendingMerge(base, 'ONE\n\ntwo\n\nthree\n\nfour'));
    renderBanner({
      pendingChange: { ...change, kind: 'RESTORE', authorName: 'Tim', restoredVersion: 12 },
    });
    expect(screen.getByText(/Tim restored version 12/)).toBeInTheDocument();
  });

  it('Merge now without conflicts posts merged markdown', async () => {
    mockGetPendingMerge.mockResolvedValue(
      pendingMerge('one\n\nOURS\n\nthree\n\nfour', 'one\n\ntwo\n\nthree\n\nFOUR'),
    );
    mockApplyMerge.mockResolvedValue(undefined);
    const { onOpenConflicts } = renderBanner();
    await screen.findByText('1 change merges cleanly, 0 overlap with yours');
    await userEvent.click(screen.getByRole('button', { name: /Merge now/ }));
    await waitFor(() =>
      expect(mockApplyMerge).toHaveBeenCalledWith('s1', 'page', {
        externalVersionId: 'ext-1',
        markdown: 'one\n\nOURS\n\nthree\n\nFOUR',
      }),
    );
    expect(onOpenConflicts).not.toHaveBeenCalled();
  });

  it('Merge now with conflicts opens the conflict view', async () => {
    mockGetPendingMerge.mockResolvedValue(
      pendingMerge('one\n\nOURS\n\nthree\n\nfour', 'one\n\nTHEIRS\n\nthree\n\nfour'),
    );
    const { onOpenConflicts } = renderBanner();
    await screen.findByText(/1 overlaps with yours/);
    await userEvent.click(screen.getByRole('button', { name: /Merge now/ }));
    expect(onOpenConflicts).toHaveBeenCalled();
    expect(mockApplyMerge).not.toHaveBeenCalled();
  });

  it('Review changes opens the conflict view', async () => {
    mockGetPendingMerge.mockResolvedValue(pendingMerge(base, 'ONE\n\ntwo\n\nthree\n\nfour'));
    const { onOpenConflicts } = renderBanner();
    await screen.findByText(/merges cleanly/);
    await userEvent.click(screen.getByRole('button', { name: /Review changes/ }));
    expect(onOpenConflicts).toHaveBeenCalled();
  });

  it('viewer sees no merge actions', () => {
    renderBanner({ canEdit: false });
    expect(screen.getByText(/Agent Smith updated this page/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Merge now/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Review changes/ })).not.toBeInTheDocument();
    expect(mockGetPendingMerge).not.toHaveBeenCalled();
  });

  it('resolved message closes the banner with Merged by', () => {
    renderBanner({ pendingChange: null, resolvedBy: 'Tim' });
    expect(screen.getByText('Merged by Tim')).toBeInTheDocument();
    expect(screen.queryByText(/updated this page/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Merge now/ })).not.toBeInTheDocument();
  });

  it('replayed pending with an ended session draft shows Unmerged edits from', async () => {
    mockGetPendingMerge.mockResolvedValue({
      ...pendingMerge('one\n\nDRAFT\n\nthree\n\nfour', 'ONE\n\ntwo\n\nthree\n\nfour'),
      oursLabel: "Sam's session",
      draftAuthorName: 'Sam',
      draftAt: '2026-10-28T09:00:00.000Z',
    });
    renderBanner({
      pendingChange: { ...change, draftAuthorName: 'Sam', draftAt: '2026-10-28T09:00:00.000Z' },
    });
    expect(
      screen.getByText(/Unmerged edits from Sam's session on Oct 28, 2026/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Merge now/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review changes/ })).toBeInTheDocument();
  });

  it('renders nothing without a pending change or resolution', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <ExternalChangeBanner
            spaceId="s1"
            pageSlug="page"
            pendingChange={null}
            resolvedBy={null}
            canEdit
            onOpenConflicts={() => {}}
          />
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
