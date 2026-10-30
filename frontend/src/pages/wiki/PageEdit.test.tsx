import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ToastProvider } from '@/components/ui/Toast';
import type { PendingChange } from '@/hooks/collab-messages';

const mockGetPage = vi.fn();
const mockGetPendingMerge = vi.fn();

vi.mock('@/api/wiki.api', () => ({
  wikiApi: {
    getPage: (...args: unknown[]) => mockGetPage(...args),
    getPendingMerge: (...args: unknown[]) => mockGetPendingMerge(...args),
    applyMerge: vi.fn(),
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
  fetchWithAuth: vi.fn(),
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
  pendingChange: PendingChange | null;
};

vi.mock('@/hooks/useCollaboration', () => ({
  useCollaboration: () => ({
    ydoc: collab.isConnected ? {} : null,
    provider: collab.isConnected ? {} : null,
    isConnected: collab.isConnected,
    isSynced: collab.isSynced,
    presenceUsers: [],
    fragmentName: 'default',
    pendingChange: collab.pendingChange,
    resolvedBy: null,
    locked: null,
    dismissResolved: () => {},
  }),
}));

vi.mock('@/components/editor/CollaborativeEditor', () => ({
  CollaborativeEditor: ({ canEdit }: { canEdit: boolean }) => (
    <div data-testid="collab-editor" data-can-edit={String(canEdit)} />
  ),
}));

vi.mock('@/components/editor/MarkdownEditor', () => ({
  MarkdownEditor: () => <div data-testid="markdown-editor" />,
}));

import PageEdit from './PageEdit';

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
