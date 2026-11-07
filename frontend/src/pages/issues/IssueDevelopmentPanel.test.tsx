import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({ get: vi.fn() }));
const dev = vi.hoisted(() => ({ issue: vi.fn() }));

vi.mock('@/api/github.api', () => ({
  githubRepoKey: (id: string) => ['github-repo', id],
  issueDevelopmentKey: (id: string, n: string) => ['issue-hydrate', id, n, 'development'],
  githubRepoApi: repo,
  githubDevelopmentApi: dev,
}));

import { IssueDevelopmentPanel } from './IssueDevelopmentPanel';

const person = (login: string, name?: string) => ({
  login,
  user: name ? { id: `u-${login}`, displayName: name } : null,
});

const pr = (over = {}) => ({
  number: 42,
  title: 'Add the widget cache',
  state: 'open',
  draft: false,
  url: 'https://github.com/acme-labs/widget/pull/42',
  author: person('mira-dev'),
  headRef: 'axm-1-widget-cache',
  baseRef: 'main',
  headSha: 'a'.repeat(40),
  mergeableState: 'clean',
  requestedReviewers: [person('sam-reviews')],
  reviews: [
    {
      author: person('jo-rev', 'Jo Reviewer'),
      state: 'commented',
      body: 'Looks fine',
      submittedAt: '2026-11-01T10:00:00Z',
    },
    {
      author: person('jo-rev', 'Jo Reviewer'),
      state: 'approved',
      body: 'Ship it',
      submittedAt: '2026-11-02T10:00:00Z',
    },
  ],
  ...over,
});

const check = (over = {}) => ({
  pullRequest: 42,
  pullRequests: [42],
  headSha: 'a'.repeat(40),
  name: 'build',
  status: 'completed',
  conclusion: 'failure',
  url: 'https://github.com/acme-labs/widget/actions/runs/1/job/2',
  failedStep: 'Run unit tests',
  logTail: 'FAIL widget.test.ts\nexpected 2 got 3',
  logTruncated: true,
  logUnavailable: false,
  ...over,
});

const capped = <T,>(items: T[]) => ({ items, limit: 20, truncated: false });

function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <IssueDevelopmentPanel projectId="p1" issueNumber="7" />
    </QueryClientProvider>,
  );
}

describe('IssueDevelopmentPanel', () => {
  beforeEach(() => {
    repo.get.mockReset();
    dev.issue.mockReset();
    repo.get.mockResolvedValue({
      repoFullName: 'acme-labs/widget',
      htmlUrl: 'https://github.com/acme-labs/widget',
    });
    dev.issue.mockResolvedValue({
      development: {
        branches: capped([
          {
            name: 'axm-1-widget-cache',
            url: 'https://github.com/acme-labs/widget/tree/axm-1-widget-cache',
            headSha: 'a',
            deleted: false,
          },
        ]),
        pullRequests: capped([pr()]),
      },
      checks: capped([check()]),
    });
  });

  it('shows an open pull request with its author, reviewers and branch', async () => {
    show();
    expect(await screen.findByText('#42')).toBeInTheDocument();
    expect(screen.getByText('Add the widget cache')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
    // Unmapped author: the login and a hint
    expect(screen.getByText('mira-dev')).toBeInTheDocument();
    expect(screen.getByText('on GitHub')).toBeInTheDocument();
    // Mapped reviewer: the display name with the latest review state only
    expect(screen.getByText('Jo Reviewer')).toBeInTheDocument();
    expect(screen.getByText('approved')).toBeInTheDocument();
    expect(screen.queryByText('commented')).toBeNull();
    expect(screen.getByText('sam-reviews')).toBeInTheDocument();
    expect(screen.getAllByText('axm-1-widget-cache').length).toBeGreaterThan(0);
  });

  it('expands a failed check to its step and log tail', async () => {
    show();
    const row = await screen.findByRole('button', { name: /build/ });
    expect(screen.queryByText('Run unit tests')).toBeNull();
    await userEvent.click(row);
    expect(screen.getByText('Run unit tests')).toBeInTheDocument();
    expect(screen.getByLabelText('Log tail').textContent).toContain('expected 2 got 3');
    expect(screen.getByText(/truncated/i)).toBeInTheDocument();
  });

  it('shows the state of a draft, merged and closed pull request', async () => {
    dev.issue.mockResolvedValue({
      development: {
        branches: capped([]),
        pullRequests: capped([
          pr({ number: 1, draft: true }),
          pr({ number: 2, state: 'merged' }),
          pr({ number: 3, state: 'closed' }),
        ]),
      },
      checks: capped([]),
    });
    show();
    expect(await screen.findByText('draft')).toBeInTheDocument();
    expect(screen.getByText('merged')).toBeInTheDocument();
    expect(screen.getByText('closed')).toBeInTheDocument();
  });

  it('shows GitHub text literally, never as markup', async () => {
    const evil = '<img src=x onerror=alert(1)> **bold** [x](javascript:alert(1))';
    dev.issue.mockResolvedValue({
      development: {
        branches: capped([]),
        pullRequests: capped([
          pr({
            title: evil,
            reviews: [
              {
                author: person('jo-rev'),
                state: 'commented',
                body: evil,
                submittedAt: '2026-11-02T10:00:00Z',
              },
            ],
          }),
        ]),
      },
      checks: capped([check({ name: evil, failedStep: evil, logTail: evil })]),
    });
    const { container } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <IssueDevelopmentPanel projectId="p1" issueNumber="7" />
      </QueryClientProvider>,
    );
    const title = await screen.findAllByText(evil);
    expect(title.length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: new RegExp('onerror') }));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(within(screen.getByLabelText('Log tail')).queryByRole('img')).toBeNull();
    expect(screen.getByLabelText('Log tail').textContent).toBe(evil);
  });

  it('opens GitHub links safely in a new tab', async () => {
    show();
    const link = await screen.findByRole('link', { name: /#42/ });
    expect(link).toHaveAttribute('href', 'https://github.com/acme-labs/widget/pull/42');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('notes a log that is unavailable', async () => {
    dev.issue.mockResolvedValue({
      development: { branches: capped([]), pullRequests: capped([pr()]) },
      checks: capped([check({ logTail: null, logUnavailable: true, logTruncated: false })]),
    });
    show();
    await userEvent.click(await screen.findByRole('button', { name: /build/ }));
    expect(screen.getByText(/log unavailable/i)).toBeInTheDocument();
  });

  it('is hidden when the project is not linked', async () => {
    repo.get.mockResolvedValue(null);
    const { container } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <IssueDevelopmentPanel projectId="p1" issueNumber="7" />
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(repo.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Development')).toBeNull();
    expect(dev.issue).not.toHaveBeenCalled();
  });

  it('says so when a linked issue has nothing yet', async () => {
    dev.issue.mockResolvedValue({
      development: { branches: capped([]), pullRequests: capped([]) },
      checks: capped([]),
    });
    show();
    expect(await screen.findByText(/no branches or pull requests/i)).toBeInTheDocument();
  });
});
