import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

// The api client reads its tokens from localStorage when it loads
vi.hoisted(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
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

import { ActivityFeed } from '@/components/ActivityFeed';
import type { Issue } from '@/lib/types';
import { RecentActivityWidget } from '@/pages/dashboard/DashboardWidgets';
import { TeamActivityCard } from '@/pages/teams/TeamActivityCard';

import { IssueDetailComments } from './IssueDetailComments';
import { IssueHeader } from './IssueHeader';

const noop = () => {};
const bot = {
  id: 'u-bot',
  username: 'nightly-triage',
  displayName: 'Nightly Triage',
  kind: 'SERVICE' as const,
};
const person = {
  id: 'u-jan',
  username: 'jan',
  displayName: 'Jan Voorbeeld',
  kind: 'PERSON' as const,
};

function header(creator: typeof bot | typeof person) {
  render(
    <IssueHeader
      issue={{
        title: 'T',
        key: 'AXM-1',
        type: 'Task',
        createdAt: new Date().toISOString(),
        creator,
        externalAuthorLogin: null,
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
}

function comments(author: typeof bot | typeof person) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <IssueDetailComments
          issue={
            {
              id: 'i1',
              comments: [
                {
                  id: 'c1',
                  body: 'hello',
                  createdAt: '2026-01-01T00:00:00Z',
                  updatedAt: '2026-01-01T00:00:00Z',
                  author,
                },
              ],
            } as unknown as Issue
          }
          projectId="p1"
          num="1"
          commentBody=""
          onCommentBodyChange={noop}
          onCommentReset={noop}
          orgSlug="acme-labs"
          teamSlug="core"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function feed(user: typeof bot | typeof person) {
  render(
    <ActivityFeed
      activities={[
        {
          id: 'a1',
          resourceType: 'issue',
          resourceId: 'i1',
          action: 'commented',
          userId: user.id,
          user,
          details: null,
          via: null,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ]}
    />,
  );
}

describe('the bot marker in issue views', () => {
  it('the issue header marks a bot creator', () => {
    header(bot);
    expect(screen.getByText(/by Nightly Triage/)).toBeInTheDocument();
    expect(screen.getByText('bot')).toBeInTheDocument();
  });

  it('the issue header shows no marker for a person', () => {
    header(person);
    expect(screen.queryByText('bot')).toBeNull();
  });

  it('a comment by a bot shows the marker beside its name', () => {
    comments(bot);
    const link = screen.getByRole('link', { name: /Nightly Triage/ });
    expect(link).toHaveAttribute('href', '/acme-labs/core/members/nightly-triage');
    expect(within(link).getByText('bot')).toBeInTheDocument();
  });

  it('a comment by a person shows no marker', () => {
    comments(person);
    expect(screen.queryByText('bot')).toBeNull();
  });

  it('an activity row by a bot shows the marker', () => {
    feed(bot);
    expect(screen.getByText('Nightly Triage')).toBeInTheDocument();
    expect(screen.getByText('bot')).toBeInTheDocument();
  });

  it('an activity row by a person shows no marker', () => {
    feed(person);
    expect(screen.queryByText('bot')).toBeNull();
  });

  it('a team activity row by a bot shows the marker', () => {
    render(
      <MemoryRouter>
        <TeamActivityCard
          orgSlug="acme-labs"
          teamSlug="core"
          activity={[
            {
              id: 'a1',
              action: 'commented',
              resourceType: 'issue',
              createdAt: '2026-01-01T00:00:00Z',
              user: bot,
            },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('bot')).toBeInTheDocument();
  });

  it('a dashboard activity row by a bot shows the marker', () => {
    render(
      <MemoryRouter>
        <RecentActivityWidget
          activities={[
            {
              id: 'a1',
              action: 'commented',
              resourceType: 'issue',
              resourceId: 'i1',
              details: null,
              createdAt: '2026-01-01T00:00:00Z',
              via: null,
              user: { ...bot, avatarUrl: null },
              resourceTitle: 'Stale ticket',
              resourceLink: null,
              resourceKey: 'AXM-1',
            },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('bot')).toBeInTheDocument();
  });
});
