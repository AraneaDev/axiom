import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

const diffVersions = vi.hoisted(() => vi.fn());
vi.mock('@/api/wiki.api', () => ({ wikiApi: { diffVersions } }));
vi.mock('./WikiLayout', () => ({ useWikiContext: () => ({ currentSpace: { id: 's1' } }) }));

import PageDiff from './PageDiff';

const side = (version: number, author: Record<string, unknown>) => ({
  version,
  title: 'Page',
  body: `body ${version}`,
  author,
  changeDescription: null,
  createdAt: '2026-11-01T00:00:00Z',
});

describe('PageDiff', () => {
  it('marks the version a bot wrote', async () => {
    diffVersions.mockResolvedValue({
      from: side(1, { id: 'u1', username: 'jan', displayName: 'Jan Voorbeeld', kind: 'PERSON' }),
      to: side(2, {
        id: 'b1',
        username: 'nightly',
        displayName: 'Nightly Triage',
        kind: 'SERVICE',
      }),
      changes: [],
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/acme-labs/core/wiki/docs/page/diff?from=1&to=2']}>
          <Routes>
            <Route path="/:org/:team/wiki/:space/:page/diff" element={<PageDiff />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Nightly Triage')).toBeInTheDocument();
    expect(screen.getAllByText('bot')).toHaveLength(1);
  });
});
