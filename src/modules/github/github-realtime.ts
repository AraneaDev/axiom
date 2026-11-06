import { broadcastToRoom } from '../../realtime/broadcast';

import { onGithubOutcome } from './github-outcomes';

// Tells the project room which issues' development panels changed, in one event per outcome. The
// room is the project's: members of it can see its issues, and no other room hears of them.
onGithubOutcome(async (outcome) => {
  const issueIds = [...new Set([...outcome.linkedIssueIds, ...outcome.removedIssueIds])];
  if (issueIds.length === 0) return;
  broadcastToRoom(`project:${outcome.projectId}`, {
    type: 'issue:development-updated',
    projectId: outcome.projectId,
    issueIds,
  });
});
