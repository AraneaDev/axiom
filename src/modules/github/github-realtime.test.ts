import { beforeEach, describe, expect, it, vi } from 'vitest';

const published = vi.hoisted(() => ({
  events: [] as { room: string; event: { issueIds: string[] } }[],
}));
vi.mock('../../realtime/bridge', () => ({
  publishRealtime: (room: string, event: { issueIds: string[] }) =>
    published.events.push({ room, event }),
}));

import { reportOutcome, type GithubEventOutcome } from './github-outcomes';
import { REALTIME_ISSUE_CHUNK } from './github-realtime';

const outcome = (linked: string[], removed: string[] = []): GithubEventOutcome => ({
  repoLinkId: 'link',
  projectId: 'cproject0000000000000000',
  event: 'push',
  action: null,
  source: 'webhook',
  actor: { login: 'octo-dev', userId: 'u', mapped: true },
  linkedIssueIds: linked,
  removedIssueIds: removed,
  drivingIssueIds: [],
  transitions: [],
  payload: {},
});

const ids = (n: number, prefix = 'i') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('issue:development-updated from an outcome', () => {
  beforeEach(() => {
    published.events.length = 0;
  });

  it('sends one event for a few issues, removed ones included once', async () => {
    await reportOutcome(outcome(['a', 'b'], ['b', 'c']));
    expect(published.events).toHaveLength(1);
    expect(published.events[0].event.issueIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('splits more than 1000 issues into events the bridge accepts, losing none', async () => {
    await reportOutcome(outcome(ids(2500)));

    expect(published.events.map((e) => e.event.issueIds.length)).toEqual([
      REALTIME_ISSUE_CHUNK,
      REALTIME_ISSUE_CHUNK,
      500,
    ]);
    expect(REALTIME_ISSUE_CHUNK).toBeLessThanOrEqual(1000);
    expect(new Set(published.events.flatMap((e) => e.event.issueIds)).size).toBe(2500);
  });

  it('says nothing when no issue changed', async () => {
    await reportOutcome(outcome([]));
    expect(published.events).toHaveLength(0);
  });
});
