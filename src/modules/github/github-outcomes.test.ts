import { describe, expect, it, vi } from 'vitest';

import { onGithubOutcome, reportOutcome, type GithubEventOutcome } from './github-outcomes';

const outcome = (projectId: string): GithubEventOutcome => ({
  repoLinkId: 'link',
  projectId,
  event: 'push',
  action: null,
  source: 'webhook',
  actor: { userId: 'u', login: 'voorbeeld-dev', mapped: false },
  linkedIssueIds: [],
  removedIssueIds: [],
  drivingIssueIds: [],
  transitions: [],
  payload: {},
});

describe('reportOutcome', () => {
  it('tells every listener, and unregisters one on request', async () => {
    const listener = vi.fn(async () => {});
    const off = onGithubOutcome(listener);
    await reportOutcome(outcome('p1'));
    off();
    await reportOutcome(outcome('p1'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports nothing for a link that is gone (no project)', async () => {
    const listener = vi.fn(async () => {});
    const off = onGithubOutcome(listener);
    await reportOutcome(outcome(''));
    off();
    expect(listener).not.toHaveBeenCalled();
  });
});
