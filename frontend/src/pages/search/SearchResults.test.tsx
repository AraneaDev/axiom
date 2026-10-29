import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSearch = vi.fn();

vi.mock('@/api/search.api', () => ({
  searchApi: {
    search: (...args: unknown[]) => mockSearch(...args),
    getAccessibleSpaces: () => Promise.resolve([]),
    getSavedSearches: () => Promise.resolve([]),
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
