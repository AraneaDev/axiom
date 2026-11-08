import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ActivityEvent } from '@/api/activity.api';

import { ActivityFeed } from './ActivityFeed';

const event = (action: string, details: Record<string, unknown>): ActivityEvent => ({
  id: action,
  resourceType: 'issue',
  resourceId: 'issue-1',
  action,
  userId: 'github-integration',
  user: { id: 'github-integration', username: 'github-integration', displayName: 'GitHub' },
  details,
  via: null,
  createdAt: new Date().toISOString(),
});

describe('ActivityFeed: GitHub import entries', () => {
  it('names the import, the kept field and what happened on GitHub', () => {
    render(
      <ActivityFeed
        activities={[
          event('imported', { githubIssueNumber: 31 }),
          event('import_conflict', { field: 'title' }),
          event('github_closed', {}),
        ]}
      />,
    );
    expect(screen.getByText('imported from GitHub')).toBeInTheDocument();
    expect(screen.getByText('#31', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('kept the Axiom value over a GitHub change of')).toBeInTheDocument();
    expect(screen.getByText('title', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('closed the GitHub issue')).toBeInTheDocument();
  });
});
