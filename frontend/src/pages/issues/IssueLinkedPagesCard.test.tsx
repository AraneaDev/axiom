import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListForIssue = vi.fn();

vi.mock('@/api/wiki-issue-links.api', () => ({
  wikiIssueLinksApi: { listForIssue: (...args: unknown[]) => mockListForIssue(...args) },
}));

const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();

vi.mock('@/hooks/useWebSocket', () => ({
  subscribe: (...args: unknown[]) => mockSubscribe(...args),
  unsubscribe: (...args: unknown[]) => mockUnsubscribe(...args),
}));

import { IssueLinkedPagesCard } from './IssueLinkedPagesCard';

const makeLink = (id: string, title: string, slug: string) => ({
  id,
  linkType: 'MENTION',
  page: {
    id: `p-${id}`,
    title,
    slug,
    space: {
      id: 's1',
      name: 'Docs',
      slug: 'docs',
      team: { slug: 'axiom', org: { slug: 'aranea' } },
    },
  },
});

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IssueLinkedPagesCard projectId="proj1" issueId="issue-1" issueNumber={7} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('IssueLinkedPagesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders each linked wiki page as a link to its page URL', async () => {
    mockListForIssue.mockResolvedValue([
      makeLink('1', 'Design notes', 'design-notes'),
      makeLink('2', 'Runbook', 'runbook'),
    ]);
    renderCard();
    const first = await screen.findByRole('link', { name: /Design notes/ });
    const second = await screen.findByRole('link', { name: /Runbook/ });
    expect(first).toHaveAttribute('href', '/aranea/axiom/wiki/docs/design-notes');
    expect(second).toHaveAttribute('href', '/aranea/axiom/wiki/docs/runbook');
    expect(mockListForIssue).toHaveBeenCalledWith('proj1', 7);
  });

  it('shows the empty state when no pages are linked', async () => {
    mockListForIssue.mockResolvedValue([]);
    renderCard();
    expect(await screen.findByText('No linked pages yet.')).toBeInTheDocument();
  });

  it('renders no branch, commit or pull request text', async () => {
    mockListForIssue.mockResolvedValue([]);
    renderCard();
    await screen.findByText('No linked pages yet.');
    expect(screen.queryByText(/branch|commit|pull request/i)).toBeNull();
  });

  it('joins the issue room so issue:links-updated reaches it, and leaves on unmount', async () => {
    mockListForIssue.mockResolvedValue([]);
    const { unmount } = renderCard();
    await screen.findByText('No linked pages yet.');
    expect(mockSubscribe).toHaveBeenCalledWith(['issue:issue-1']);
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledWith(['issue:issue-1']);
  });
});
