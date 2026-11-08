import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/editor/MarkdownEditor', () => ({ MarkdownEditor: () => null }));
vi.mock('@/components/editor/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/api/issues.api', () => ({ issuesApi: {} }));
vi.mock('@/hooks/useIssueInvalidation', () => ({
  useIssueInvalidation: () => ({ invalidateIssue: vi.fn() }),
}));
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({ user: { id: 'u-viewer' } }),
}));

import type { Issue } from '@/lib/types';

import { IssueDetailComments } from './IssueDetailComments';
import { IssueHeader } from './IssueHeader';

const noop = () => {};
const header = (issue: Record<string, unknown>) =>
  render(
    <IssueHeader
      issue={{
        title: 'T',
        key: 'AXM-1',
        type: 'Task',
        createdAt: new Date().toISOString(),
        ...issue,
      }}
      titleDraft=""
      isTitleEditing={false}
      onTitleDraftChange={noop}
      onStartEditTitle={noop}
      onSaveTitle={noop}
      onCancelTitle={noop}
      onVote={noop}
      onWatch={noop}
    />,
  );

const comment = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  body: 'hello',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  author: { id: 'u-bot', username: 'github-bot', displayName: 'Integration Bot' },
  ...over,
});

function comments(list: unknown[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <IssueDetailComments
          issue={{ id: 'i1', comments: list } as unknown as Issue}
          projectId="p1"
          num="1"
          commentBody=""
          onCommentBodyChange={noop}
          onCommentReset={noop}
          orgSlug="acme"
          teamSlug="core"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('imported authors', () => {
  it('header shows GitHub (login) for an imported issue', () => {
    header({
      creator: { displayName: 'Integration Bot' },
      externalAuthorLogin: 'octo-voorbeeld',
    });
    expect(screen.getByText(/by GitHub \(octo-voorbeeld\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Integration Bot/)).toBeNull();
  });

  it('header shows the creator otherwise', () => {
    header({ creator: { displayName: 'Tim Voorbeeld' }, externalAuthorLogin: null });
    expect(screen.getByText(/by Tim Voorbeeld/)).toBeInTheDocument();
  });

  it('an imported comment shows GitHub (login) as plain text, not a member link', () => {
    comments([comment({ externalAuthorLogin: 'octo-voorbeeld' })]);
    expect(screen.getByText('GitHub (octo-voorbeeld)')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('Integration Bot')).toBeNull();
  });

  it('the avatar of an imported comment has no stray bracket as initials', () => {
    comments([comment({ externalAuthorLogin: 'octo-voorbeeld' })]);
    expect(screen.queryByText('G(')).toBeNull();
  });

  it('a normal comment links the author to the member page', () => {
    comments([
      comment({
        author: { id: 'u2', username: 'jan', displayName: 'Jan Voorbeeld' },
        externalAuthorLogin: null,
      }),
    ]);
    expect(screen.getByRole('link', { name: 'Jan Voorbeeld' })).toHaveAttribute(
      'href',
      '/acme/core/members/jan',
    );
  });
});
