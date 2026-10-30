import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ToastProvider } from '@/components/ui/Toast';

const mockGetPendingMerge = vi.fn();
const mockApplyMerge = vi.fn();

vi.mock('@/api/wiki.api', () => ({
  wikiApi: {
    getPendingMerge: (...args: unknown[]) => mockGetPendingMerge(...args),
    applyMerge: (...args: unknown[]) => mockApplyMerge(...args),
  },
}));

import { ConflictView } from './ConflictView';

// Two conflicts: block two and block four changed on both sides
const merge = {
  base: 'one\n\ntwo\n\nthree\n\nfour',
  ours: 'one\n\nours two\n\nthree\n\nours four',
  theirs: 'one\n\ntheirs two\n\nthree\n\ntheirs four',
  oursLabel: 'Yours',
  theirsLabel: 'Agent Smith',
  externalVersionId: 'ext-1',
  authorName: 'Agent Smith',
  at: '2026-10-29T10:00:00.000Z',
};

function renderView() {
  const onClose = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ConflictView spaceId="s1" pageSlug="page" externalVersionId="ext-1" onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onClose };
}

const finishButton = () => screen.getByRole('button', { name: /Finish merge/ });
const result = () => screen.getByLabelText('Result') as HTMLTextAreaElement;

async function selectConflict(n: number) {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`Conflict ${n}`) }));
}

describe('ConflictView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPendingMerge.mockResolvedValue(merge);
  });

  it('Finish disabled until all conflicts resolved', async () => {
    renderView();
    await screen.findByRole('button', { name: /Conflict 2/ });
    expect(finishButton()).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Use Yours' }));
    expect(finishButton()).toBeDisabled();

    await selectConflict(2);
    await userEvent.click(screen.getByRole('button', { name: 'Use Agent Smith' }));
    expect(finishButton()).toBeEnabled();
  });

  it('Use yours / Use theirs fill the result', async () => {
    renderView();
    await screen.findByRole('button', { name: /Conflict 1/ });
    expect(screen.getByText('ours two')).toBeInTheDocument();
    expect(screen.getByText('theirs two')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Use Yours' }));
    expect(result().value).toBe('ours two');
    await userEvent.click(screen.getByRole('button', { name: 'Use Agent Smith' }));
    expect(result().value).toBe('theirs two');

    const list = screen.getByRole('list', { name: 'Conflicts' });
    expect(within(list).getByText('Resolved')).toBeInTheDocument();
    expect(within(list).getByText('Open')).toBeInTheDocument();
  });

  it('hand edit is used', async () => {
    mockApplyMerge.mockResolvedValue(undefined);
    const { onClose } = renderView();
    await screen.findByRole('button', { name: /Conflict 1/ });
    await userEvent.type(result(), 'hand two');
    await selectConflict(2);
    await userEvent.click(screen.getByRole('button', { name: 'Use Agent Smith' }));
    await userEvent.click(finishButton());

    await waitFor(() =>
      expect(mockApplyMerge).toHaveBeenCalledWith('s1', 'page', {
        externalVersionId: 'ext-1',
        markdown: 'one\n\nhand two\n\nthree\n\ntheirs four',
        ours: merge.ours,
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('409 shows toast and reloads', async () => {
    mockApplyMerge.mockRejectedValue(Object.assign(new Error('stale'), { status: 409 }));
    renderView();
    await screen.findByRole('button', { name: /Conflict 1/ });
    await userEvent.click(screen.getByRole('button', { name: 'Use Yours' }));
    await selectConflict(2);
    await userEvent.click(screen.getByRole('button', { name: 'Use Yours' }));
    await userEvent.click(finishButton());

    expect(await screen.findByText('This page changed again')).toBeInTheDocument();
    await waitFor(() => expect(mockGetPendingMerge).toHaveBeenCalledTimes(2));
  });

  it('closes when the reload finds nothing pending', async () => {
    mockApplyMerge.mockRejectedValue(Object.assign(new Error('stale'), { status: 409 }));
    const { onClose } = renderView();
    await screen.findByRole('button', { name: /Conflict 1/ });
    await userEvent.click(screen.getByRole('button', { name: 'Use Yours' }));
    await selectConflict(2);
    await userEvent.click(screen.getByRole('button', { name: 'Use Yours' }));
    mockGetPendingMerge.mockResolvedValue(null);
    await userEvent.click(finishButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('without conflicts shows both sides and finishes with the clean merge', async () => {
    mockGetPendingMerge.mockResolvedValue({
      ...merge,
      ours: 'one\n\nours two\n\nthree\n\nfour',
      theirs: 'one\n\ntwo\n\nthree\n\ntheirs four',
    });
    mockApplyMerge.mockResolvedValue(undefined);
    renderView();
    expect(await screen.findByText(/No overlapping changes/)).toBeInTheDocument();
    await userEvent.click(finishButton());
    await waitFor(() =>
      expect(mockApplyMerge).toHaveBeenCalledWith('s1', 'page', {
        externalVersionId: 'ext-1',
        markdown: 'one\n\nours two\n\nthree\n\ntheirs four',
        ours: 'one\n\nours two\n\nthree\n\nfour',
      }),
    );
  });

  it('choices survive a refetch with identical data', async () => {
    mockApplyMerge.mockRejectedValue(
      Object.assign(new Error('stale'), { status: 409, code: 'MERGE_STALE' }),
    );
    renderView();
    await screen.findByRole('button', { name: /Conflict 1/ });
    await userEvent.click(screen.getByRole('button', { name: 'Use Yours' }));
    await selectConflict(2);
    await userEvent.type(result(), 'hand four');
    await userEvent.click(finishButton());
    await waitFor(() => expect(mockGetPendingMerge).toHaveBeenCalledTimes(2));

    const list = screen.getByRole('list', { name: 'Conflicts' });
    await waitFor(() => expect(within(list).getAllByText('Resolved')).toHaveLength(2));
    expect(result().value).toBe('hand four');
    expect(finishButton()).toBeEnabled();
  });

  it('choices for unchanged conflicts carry over when the data changes', async () => {
    mockApplyMerge.mockRejectedValue(
      Object.assign(new Error('stale'), { status: 409, code: 'MERGE_STALE' }),
    );
    renderView();
    await screen.findByRole('button', { name: /Conflict 1/ });
    await userEvent.click(screen.getByRole('button', { name: 'Use Yours' }));
    await selectConflict(2);
    await userEvent.click(screen.getByRole('button', { name: 'Use Yours' }));
    // The agent changed block four again: conflict 2 is a different conflict now
    mockGetPendingMerge.mockResolvedValue({
      ...merge,
      theirs: 'one\n\ntheirs two\n\nthree\n\ntheirs four again',
    });
    await userEvent.click(finishButton());

    const list = screen.getByRole('list', { name: 'Conflicts' });
    await waitFor(() => expect(within(list).getAllByText('Open')).toHaveLength(1));
    expect(within(list).getAllByText('Resolved')).toHaveLength(1);
    expect(finishButton()).toBeDisabled();
    await selectConflict(2);
    expect(screen.getByText('theirs four again')).toBeInTheDocument();
    expect(result().value).toBe('');
  });

  it('an emptied result stays Open', async () => {
    renderView();
    await screen.findByRole('button', { name: /Conflict 1/ });
    await userEvent.type(result(), 'x');
    await userEvent.clear(result());
    const list = screen.getByRole('list', { name: 'Conflicts' });
    expect(within(list).queryByText('Resolved')).not.toBeInTheDocument();
    expect(within(list).getAllByText('Open')).toHaveLength(2);
  });

  it('Remove passage resolves the conflict without the passage', async () => {
    mockApplyMerge.mockResolvedValue(undefined);
    renderView();
    await screen.findByRole('button', { name: /Conflict 1/ });
    await userEvent.click(screen.getByRole('button', { name: /Remove passage/ }));
    await selectConflict(2);
    await userEvent.click(screen.getByRole('button', { name: 'Use Yours' }));
    await userEvent.click(finishButton());
    await waitFor(() =>
      expect(mockApplyMerge).toHaveBeenCalledWith('s1', 'page', {
        externalVersionId: 'ext-1',
        markdown: 'one\n\nthree\n\nours four',
        ours: merge.ours,
      }),
    );
  });

  it('a 409 because someone else is merging has its own toast', async () => {
    mockApplyMerge.mockRejectedValue(
      Object.assign(new Error('busy'), { status: 409, code: 'MERGE_IN_PROGRESS' }),
    );
    renderView();
    await screen.findByRole('button', { name: /Conflict 1/ });
    await userEvent.click(screen.getByRole('button', { name: 'Use Yours' }));
    await selectConflict(2);
    await userEvent.click(screen.getByRole('button', { name: 'Use Yours' }));
    await userEvent.click(finishButton());
    expect(await screen.findByText('Someone else is merging this page')).toBeInTheDocument();
  });
});
