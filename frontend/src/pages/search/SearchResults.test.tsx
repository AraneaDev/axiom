import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSearch = vi.fn();
const mockSaved = vi.fn(() => Promise.resolve([] as unknown[]));

vi.mock('@/api/search.api', () => ({
  searchApi: {
    search: (...args: unknown[]) => mockSearch(...args),
    getAccessibleSpaces: () => Promise.resolve([]),
    getSavedSearches: () => mockSaved(),
    createSavedSearch: vi.fn(),
    deleteSavedSearch: vi.fn(),
  },
}));

import { ToastProvider } from '@/components/ui/Toast';

import SearchResults from './SearchResults';

function renderAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <SearchResults />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('SearchResults type param', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue([]);
  });

  it.each(['code', 'repos', 'bogus'])(
    'treats an unknown ?type=%s (old links, saved filters) as all',
    async (type) => {
      renderAt(`/search?q=hello&type=${type}`);
      await waitFor(() => expect(mockSearch).toHaveBeenCalled());
      expect(mockSearch).toHaveBeenCalledWith('hello', 'all', {});
    },
  );

  it('keeps a known type', async () => {
    renderAt('/search?q=hello&type=wiki');
    await waitFor(() => expect(mockSearch).toHaveBeenCalled());
    expect(mockSearch).toHaveBeenCalledWith('hello', 'wiki', {});
  });
});

describe('SearchResults saved searches', () => {
  it('lists only saved searches that have a q', async () => {
    mockSearch.mockResolvedValue([]);
    mockSaved.mockResolvedValue([
      { id: 's1', name: 'Real search', query: { q: 'hello' } },
      { id: 's2', name: 'Text query row', query: { kind: 'query', text: 'type = BUG' } },
    ]);
    renderAt('/search?q=hello');
    await waitFor(() => expect(mockSaved).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Saved/ }));
    expect(await screen.findByText('Real search')).toBeTruthy();
    expect(screen.queryByText('Text query row')).toBeNull();
  });
});
