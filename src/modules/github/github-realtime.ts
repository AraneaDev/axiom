import { publishRealtime } from '../../realtime/bridge';

import { onGithubOutcome } from './github-outcomes';

// The bridge refuses an event with more issue ids than this, so a producer sends chunks
export const REALTIME_ISSUE_CHUNK = 1000;

// Tells the project room which issues' development panels changed, in one event per outcome. The
// room is the project's: members of it can see its issues, and no other room hears of them.
onGithubOutcome(async (outcome) => {
  const issueIds = [...new Set([...outcome.linkedIssueIds, ...outcome.removedIssueIds])];
  if (issueIds.length === 0) return;
  for (let i = 0; i < issueIds.length; i += REALTIME_ISSUE_CHUNK) {
    publishRealtime(`project:${outcome.projectId}`, {
      type: 'issue:development-updated',
      projectId: outcome.projectId,
      issueIds: issueIds.slice(i, i + REALTIME_ISSUE_CHUNK),
    });
  }
});
