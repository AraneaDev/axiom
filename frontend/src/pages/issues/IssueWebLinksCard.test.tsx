import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockList = vi.fn();
const mockAdd = vi.fn();
const mockRemove = vi.fn();

vi.mock('@/api/issue-web-links.api', () => ({
  issueWebLinksApi: {
    list: (...args: unknown[]) => mockList(...args),
    add: (...args: unknown[]) => mockAdd(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
  },
}));

import { IssueWebLinksCard } from './IssueWebLinksCard';

const link = (id: string, url: string, title: string | null) => ({
  id,
  url,
  title,
  createdAt: '2026-11-04T10:00:00.000Z',
  createdBy: { id: 'u1', username: 'tim', displayName: 'Tim' },
});

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <IssueWebLinksCard projectId="proj1" issueNumber={7} />
    </QueryClientProvider>,
  );
}

describe('IssueWebLinksCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdd.mockResolvedValue(link('new', 'https://example.com/new', null));
    mockRemove.mockResolvedValue(undefined);
  });

  it('shows the title of a link, or its URL without one', async () => {
    mockList.mockResolvedValue([
      link('a', 'https://example.com/a', 'Spec'),
      link('b', 'https://example.com/b', null),
    ]);
    renderCard();
    expect(await screen.findByText('Spec')).toHaveAttribute('href', 'https://example.com/a');
    expect(screen.getByText('https://example.com/b')).toBeInTheDocument();
  });

  it('adds a link', async () => {
    mockList.mockResolvedValue([]);
    renderCard();
    await userEvent.type(await screen.findByLabelText('Link URL'), 'https://example.com/new');
    await userEvent.click(screen.getByRole('button', { name: /add link/i }));
    await waitFor(() =>
      expect(mockAdd).toHaveBeenCalledWith('proj1', 7, { url: 'https://example.com/new' }),
    );
  });

  it('removes a link', async () => {
    mockList.mockResolvedValue([link('a', 'https://example.com/a', 'Spec')]);
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove link' }));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('proj1', 7, 'a'));
  });
});
