import { settled } from '../../utils/settled';
import { listActivities } from '../activity/activity.service';
import { listAttachments } from '../attachments/attachments.service';
import { listFieldDefinitions } from '../custom-fields/custom-fields.service';
import { listSprints } from '../sprints/sprints.service';

import { getBranches } from './issue-branches.service';
import { getCommits } from './issue-commits.service';
import { getChildren, getIssuePullRequests } from './issue-hierarchy.service';
import { getLinks } from './issue-links.service';
import { getWorklogs } from './issue-time.service';
import { getVotes } from './issue-votes.service';
import { getWatchers } from './issue-watchers.service';
import { getIssue, getEpicProgress } from './issues.service';

/**
 * Hydrate the full Issue Detail view in a single call.
 * The primary issue lookup is performed first (404 if not found).
 * All secondary queries fan out in parallel via Promise.allSettled so
 * partial failures degrade gracefully without blocking the response.
 * @param projectId - The project containing the issue
 * @param issueNumber - The issue number within the project
 * @param userId - The requesting user (used for vote status)
 */
export async function hydrateIssueDetail(projectId: string, issueNumber: number, userId: string) {
  // Primary lookup -- must succeed or 404
  const issue = await getIssue(projectId, issueNumber);

  // Resolve the issue ID for activity and attachment lookups
  const issueId = issue.id;

  // Fan out all secondary queries
  const results = await Promise.allSettled([
    getVotes(projectId, issueNumber, userId),
    getWatchers(projectId, issueNumber),
    getLinks(projectId, issueNumber),
    getChildren(projectId, issueNumber),
    getEpicProgress(projectId, issueNumber),
    getBranches(projectId, issueNumber),
    getIssuePullRequests(projectId, issueNumber),
    getCommits(projectId, issueNumber),
    getWorklogs(projectId, issueNumber),
    listActivities({ resourceType: 'issue', resourceId: issueId }),
    listAttachments({ issueId }),
    listSprints(projectId),
    listFieldDefinitions(projectId),
  ]);

  return {
    issue,
    votes: settled(results[0], 'votes'),
    watchers: settled(results[1], 'watchers'),
    links: settled(results[2], 'links'),
    children: settled(results[3], 'children'),
    progress: settled(results[4], 'progress'),
    development: {
      branches: settled(results[5], 'branches'),
      pullRequests: settled(results[6], 'pullRequests'),
      commits: settled(results[7], 'commits'),
    },
    activity: settled(results[9], 'activity'),
    attachments: settled(results[10], 'attachments'),
    worklogs: settled(results[8], 'worklogs'),
    sprints: settled(results[11], 'sprints'),
    customFields: settled(results[12], 'customFields'),
  };
}
