import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/components/ui/Toast';

const spaces = vi.hoisted(() => ({
  value: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/api/wiki.api', () => ({ wikiApi: { updateSpace: vi.fn() } }));
vi.mock('@/api/space-permissions.api', () => ({
  spacePermissionsApi: { list: vi.fn().mockResolvedValue([]), upsert: vi.fn(), remove: vi.fn() },
}));
vi.mock('./WikiLayout', () => ({
  useWikiContext: () => ({ spaces: spaces.value, currentTeam: { id: 't1' } }),
}));

import WikiHome from './WikiHome';

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/aranea/axiom/wiki']}>
          <Routes>
            <Route path="/:org/:team/wiki" element={<WikiHome />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('WikiHome space permissions', () => {
  it('offers the permissions of a space only to someone who administers it', () => {
    spaces.value = [
      { id: 's1', slug: 'docs', name: 'Docs', canManage: true, _count: { pages: 2 } },
      { id: 's2', slug: 'notes', name: 'Notes', canManage: false, _count: { pages: 1 } },
    ];
    renderHome();
    expect(screen.getAllByRole('button', { name: /permissions/i })).toHaveLength(1);
  });

  it('opens the panel of that space', async () => {
    spaces.value = [{ id: 's1', slug: 'docs', name: 'Docs', canManage: true }];
    renderHome();
    await userEvent.click(screen.getByRole('button', { name: /permissions/i }));
    expect(await screen.findByText('No custom permissions')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Docs');
  });
});
