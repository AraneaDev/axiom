import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ToastProvider } from '@/components/ui/Toast';
import type { PendingChange } from '@/hooks/collab-messages';

const mockGetPage = vi.fn();
const mockGetPendingMerge = vi.fn();
const mockUpdatePage = vi.fn();
const mockFlushCollab = vi.fn();

vi.mock('@/api/wiki.api', () => ({
  wikiApi: {
    getPage: (...args: unknown[]) => mockGetPage(...args),
    getPendingMerge: (...args: unknown[]) => mockGetPendingMerge(...args),
    applyMerge: vi.fn(),
    updatePage: (...args: unknown[]) => mockUpdatePage(...args),
    flushCollab: (...args: unknown[]) => mockFlushCollab(...args),
    listTemplates: () => Promise.resolve([]),
    getPageTree: () => Promise.resolve([]),
  },
}));

vi.mock('@/api/attachments.api', () => ({
  attachmentsApi: { list: () => Promise.resolve([]), remove: vi.fn(), upload: vi.fn() },
}));

vi.mock('@/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  getAccessToken: () => 'token',
}));

vi.mock('@/stores/auth.store', () => {
  const state = { user: { id: 'u1', username: 'tim', displayName: 'Tim' } };
  return {
    useAuthStore: (select?: (s: unknown) => unknown) => (select ? select(state) : state),
  };
});

vi.mock('./WikiLayout', () => ({
  useWikiContext: () => ({ currentSpace: { id: 's1' }, currentTeam: { id: 't1' } }),
}));

// The collaboration session, as the test sets it
let collab: {
  isConnected: boolean;
  isSynced: boolean;
  hasSynced?: boolean;
  sessionEnded?: boolean;
  pendingChange: PendingChange | null;
};

const lastEnabled: Array<boolean | undefined> = [];
const mockRejoin = vi.fn();
const editorOnChange: { current?: (md: string) => void } = {};

vi.mock('@/hooks/useCollaboration', () => ({
  useCollaboration: (options: { enabled?: boolean }) => {
    lastEnabled.push(options.enabled);
    return {
      ydoc: {},
      provider: {},
      isConnected: collab.isConnected,
      isSynced: collab.isSynced,
      hasSynced: collab.hasSynced ?? collab.isSynced,
      presenceUsers: [],
      fragmentName: 'default',
      pendingChange: collab.pendingChange,
      resolvedBy: null,
      locked: null,
      readOnly: false,
      dismissResolved: () => {},
      sessionEnded: collab.sessionEnded ?? false,
      rejoin: mockRejoin,
    };
  },
}));

vi.mock('@/components/editor/CollaborativeEditor', () => ({
  CollaborativeEditor: ({
    canEdit,
    onChange,
  }: {
    canEdit: boolean;
    onChange: (md: string) => void;
  }) => {
    editorOnChange.current = onChange;
    return <div data-testid="collab-editor" data-can-edit={String(canEdit)} />;
  },
}));

vi.mock('@/components/editor/MarkdownEditor', () => ({
  MarkdownEditor: () => <div data-testid="markdown-editor" />,
}));

import PageEdit, { COLLAB_SYNC_TIMEOUT_MS } from './PageEdit';

const page = (extra: Record<string, unknown> = {}) => ({
  id: 'p1',
  spaceId: 's1',
  title: 'Page',
  slug: 'page',
  body: 'one\n\ntwo',
  isDraft: false,
  createdAt: '2026-10-29T10:00:00.000Z',
  updatedAt: '2026-10-29T10:00:00.000Z',
  ...extra,
});

const change: PendingChange = {
  externalVersionId: 'ext-1',
  authorName: 'Agent Smith',
  at: new Date().toISOString(),
  kind: 'EXTERNAL',
};

const conflicting = {
  base: 'one\n\ntwo',
  ours: 'one\n\nours two',
  theirs: 'one\n\ntheirs two',
  oursLabel: 'Yours',
  theirsLabel: 'Agent Smith',
  externalVersionId: 'ext-1',
  authorName: 'Agent Smith',
  at: change.at,
};

function renderEdit() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/aranea/axiom/wiki/docs/page/edit']}>
          <Routes>
            <Route path="/:org/:team/wiki/:space/:page/edit" element={<PageEdit />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  const utils = render(tree());
  return { rerender: () => utils.rerender(tree()) };
}

describe('PageEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collab = { isConnected: true, isSynced: true, pendingChange: null };
  });

  it('a viewer gets a read-only editor and no merge actions from the first render', async () => {
    mockGetPage.mockResolvedValue(page({ canEdit: false }));
    collab.pendingChange = change;
    renderEdit();
    const editor = await screen.findByTestId('collab-editor');
    expect(editor).toHaveAttribute('data-can-edit', 'false');
    expect(screen.getByText(/Agent Smith updated this page/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Merge now/ })).not.toBeInTheDocument();
    expect(mockGetPendingMerge).not.toHaveBeenCalled();
  });

  it('a viewer gets no Save button and a read-only title', async () => {
    mockGetPage.mockResolvedValue(page({ canEdit: false }));
    renderEdit();
    await screen.findByTestId('collab-editor');
    expect(screen.queryByRole('button', { name: /^Save$/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Title/)).toHaveAttribute('readonly');
  });

  it('an editor keeps the Save button and an editable title', async () => {
    mockGetPage.mockResolvedValue(page({ canEdit: true }));
    renderEdit();
    await screen.findByTestId('collab-editor');
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/Title/)).not.toHaveAttribute('readonly');
  });

  it('saving an existing page sends no parentId, so a child page stays where it is', async () => {
    mockGetPage.mockResolvedValue(page({ canEdit: true, parentId: 'parent-1' }));
    mockUpdatePage.mockResolvedValue(page());
    mockFlushCollab.mockResolvedValue({ flushed: true });
    renderEdit();
    await screen.findByTestId('collab-editor');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(mockUpdatePage).toHaveBeenCalled());
    const body = mockUpdatePage.mock.calls[0][2] as Record<string, unknown>;
    expect(body).not.toHaveProperty('parentId');
  });

  it('a viewer sees the page read-only before the session connects', async () => {
    mockGetPage.mockResolvedValue(page({ canEdit: false }));
    collab = { isConnected: false, isSynced: false, pendingChange: null };
    renderEdit();
    expect(await screen.findByText('two')).toBeInTheDocument();
    expect(screen.queryByTestId('markdown-editor')).not.toBeInTheDocument();
  });

  it('an editor gets an editable editor', async () => {
    mockGetPage.mockResolvedValue(page({ canEdit: true }));
    renderEdit();
    expect(await screen.findByTestId('collab-editor')).toHaveAttribute('data-can-edit', 'true');
  });

  describe('typed text never disappears in a swap of editors', () => {
    it('offers no editor to type in until the session has synced', async () => {
      mockGetPage.mockResolvedValue(page({ canEdit: true }));
      collab = { isConnected: false, isSynced: false, pendingChange: null };
      renderEdit();
      expect(await screen.findByText('two')).toBeInTheDocument();
      expect(screen.queryByTestId('markdown-editor')).not.toBeInTheDocument();
      expect(screen.queryByTestId('collab-editor')).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(/live session/i);
    });

    it('keeps the collaborative editor through a lost connection', async () => {
      mockGetPage.mockResolvedValue(page({ canEdit: true }));
      const { rerender } = renderEdit();
      await screen.findByTestId('collab-editor');
      collab = { isConnected: false, isSynced: false, hasSynced: true, pendingChange: null };
      rerender();
      expect(screen.getByTestId('collab-editor')).toBeInTheDocument();
      expect(screen.queryByTestId('markdown-editor')).not.toBeInTheDocument();
    });

    it('saves the local text, not the server session, while the connection is lost', async () => {
      mockGetPage.mockResolvedValue(page({ canEdit: true }));
      mockUpdatePage.mockResolvedValue(page());
      const { rerender } = renderEdit();
      await screen.findByTestId('collab-editor');
      collab = { isConnected: false, isSynced: false, hasSynced: true, pendingChange: null };
      rerender();
      await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
      await waitFor(() => expect(mockUpdatePage).toHaveBeenCalled());
      expect(mockFlushCollab).not.toHaveBeenCalled();
      expect(mockUpdatePage.mock.calls[0][2]).toHaveProperty('body', 'one\n\ntwo');
    });

    it('hands text typed in an ended session to the new session as a change to merge', async () => {
      mockGetPage.mockResolvedValue(page({ canEdit: true }));
      mockUpdatePage.mockResolvedValue(page());
      const { rerender } = renderEdit();
      await screen.findByTestId('collab-editor');
      collab = { isConnected: false, isSynced: false, hasSynced: true, pendingChange: null };
      rerender();
      act(() => editorOnChange.current!('Typed offline'));

      collab = { ...collab, sessionEnded: true };
      rerender();
      await waitFor(() => expect(mockRejoin).toHaveBeenCalledTimes(1));
      // Not yet: without a live session it would overwrite whatever the page has become
      expect(mockUpdatePage).not.toHaveBeenCalled();

      collab = { isConnected: true, isSynced: true, hasSynced: true, pendingChange: null };
      rerender();
      await waitFor(() => expect(mockUpdatePage).toHaveBeenCalledTimes(1));
      expect(mockUpdatePage.mock.calls[0][2]).toEqual({ body: 'Typed offline' });
    });

    it('sends nothing when the ended session had no text typed offline', async () => {
      mockGetPage.mockResolvedValue(page({ canEdit: true }));
      const { rerender } = renderEdit();
      await screen.findByTestId('collab-editor');
      collab = {
        isConnected: false,
        isSynced: false,
        hasSynced: true,
        sessionEnded: true,
        pendingChange: null,
      };
      rerender();
      await waitFor(() => expect(mockRejoin).toHaveBeenCalled());
      collab = { isConnected: true, isSynced: true, hasSynced: true, pendingChange: null };
      rerender();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mockUpdatePage).not.toHaveBeenCalled();
    });

    it('leaves a reconnect to the same session to the document itself', async () => {
      mockGetPage.mockResolvedValue(page({ canEdit: true }));
      const { rerender } = renderEdit();
      await screen.findByTestId('collab-editor');
      collab = { isConnected: false, isSynced: false, hasSynced: true, pendingChange: null };
      rerender();
      act(() => editorOnChange.current!('Typed offline'));
      collab = { isConnected: true, isSynced: true, hasSynced: true, pendingChange: null };
      rerender();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mockUpdatePage).not.toHaveBeenCalled();
    });

    it('gives up on a session that never syncs, for good, and leaves the session', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        mockGetPage.mockResolvedValue(page({ canEdit: true }));
        collab = { isConnected: false, isSynced: false, pendingChange: null };
        const { rerender } = renderEdit();
        await screen.findByText('two');
        await act(() => vi.advanceTimersByTimeAsync(COLLAB_SYNC_TIMEOUT_MS));
        expect(screen.getByTestId('markdown-editor')).toBeInTheDocument();
        expect(lastEnabled.at(-1)).toBe(false);
        // A sync after this must not replace what was typed
        collab = { isConnected: true, isSynced: true, pendingChange: null };
        rerender();
        expect(screen.getByTestId('markdown-editor')).toBeInTheDocument();
        expect(screen.queryByTestId('collab-editor')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('a 403 from the pending merge still makes the editor read-only', async () => {
    mockGetPage.mockResolvedValue(page());
    mockGetPendingMerge.mockRejectedValue(Object.assign(new Error('no'), { status: 403 }));
    collab.pendingChange = change;
    renderEdit();
    await waitFor(() =>
      expect(screen.getByTestId('collab-editor')).toHaveAttribute('data-can-edit', 'false'),
    );
  });

  it('the conflict view closes when the pending change clears', async () => {
    mockGetPage.mockResolvedValue(page({ canEdit: true }));
    mockGetPendingMerge.mockResolvedValue(conflicting);
    collab.pendingChange = change;
    const { rerender } = renderEdit();
    await screen.findByText(/1 overlaps with yours/);
    await userEvent.click(screen.getByRole('button', { name: /Review changes/ }));
    expect(await screen.findByText('Merge Yours with Agent Smith')).toBeInTheDocument();

    collab.pendingChange = null;
    rerender();
    await waitFor(() =>
      expect(screen.queryByText('Merge Yours with Agent Smith')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('collab-editor')).toBeVisible();
  });
});
