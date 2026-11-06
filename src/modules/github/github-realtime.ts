import { broadcastToRoom } from '../../realtime/broadcast';

import { onGithubOutcome } from './github-events';

// Tells the project room which issues' development panels changed. The room is the project's:
// members of it can see its issues, and no other room hears of them.
onGithubOutcome(async (outcome) => {
  for (const issueId of new Set([...outcome.linkedIssueIds, ...outcome.removedIssueIds])) {
    broadcastToRoom(`project:${outcome.projectId}`, {
      type: 'issue:development-updated',
      projectId: outcome.projectId,
      issueId,
    });
  }
});
