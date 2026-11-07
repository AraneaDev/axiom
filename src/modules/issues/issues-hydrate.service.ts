import { parsePagination } from '../../utils/pagination';
import { settled } from '../../utils/settled';
import { listActivities } from '../activity/activity.service';
import { listAttachments } from '../attachments/attachments.service';
import { listFieldDefinitions } from '../custom-fields/custom-fields.service';
import {
  CHECKS_LIMIT,
  DEVELOPMENT_LIMIT,
  loadChecks,
  loadDevelopment,
} from '../github/github-reads';
import { list as listSavedFilters } from '../saved-filters/saved-filters.service';
import { listSprints } from '../sprints/sprints.service';

import { getBoard } from './issue-board.service';
import { getChildren } from './issue-hierarchy.service';
import { getLinks } from './issue-links.service';
import { getWorklogs } from './issue-time.service';
import { getVotes } from './issue-votes.service';
import { getWatchers } from './issue-watchers.service';
import { getIssue, getEpicProgress, listIssues } from './issues.service';

/**
 * Hydrate the full Issue Detail view in a single call.
 * The primary issue lookup is performed first (404 if not found).
 * All secondary queries fan out in parallel via Promise.allSettled so
 * partial failures degrade gracefully without blocking the response.
 * @param projectId - The project containing the issue
 * @param issueNumber - The issue number within the project
 * @param userId - The requesting user (used for vote status)
 * @param include - The GitHub panels to add: `development` and `checks`
 * @param githubCovered - Whether the caller gets the GitHub panels here: a session does. A token
 *   reads them through item.read, which marks GitHub text as untrusted and counts it against its
 *   byte budget, so the panels asked for are named in `omittedIncludes` with the reason
 */
export async function hydrateIssueDetail(
  projectId: string,
  issueNumber: number,
  userId: string,
  include: readonly ('development' | 'checks')[] = [],
  githubCovered = true,
) {
  // Primary lookup -- must succeed or 404
  const issue = await getIssue(projectId, issueNumber);

  // Resolve the issue ID for activity and attachment lookups
  const issueId = issue.id;

  // Fan out all secondary queries
  const results = await Promise.allSettled([
    getVotes(projectId, issueNumber, userId),
    getWatchers(projectId, issueNumber),
    getLinks(projectId, issueNumber, userId),
    getChildren(projectId, issueNumber),
    getEpicProgress(projectId, issueNumber),
    getWorklogs(projectId, issueNumber),
    listActivities({ resourceType: 'issue', resourceId: issueId }),
    listAttachments({ issueId }, userId),
    listSprints(projectId),
    listFieldDefinitions(projectId),
  ]);

  const asked = [...new Set(include)];
  const github = githubCovered ? asked : [];
  const [development, checks] = await Promise.all([
    github.includes('development') ? loadDevelopment(issueId, DEVELOPMENT_LIMIT) : undefined,
    github.includes('checks') ? loadChecks(issueId, CHECKS_LIMIT) : undefined,
  ]);

  return {
    issue,
    ...(development && { development }),
    ...(checks && { checks }),
    ...(!githubCovered &&
      asked.length > 0 && {
        omittedIncludes: asked,
        omittedIncludesReason: 'GitHub data is read with item.read (include development, checks)',
      }),
    votes: settled(results[0], 'votes'),
    watchers: settled(results[1], 'watchers'),
    links: settled(results[2], 'links'),
    children: settled(results[3], 'children'),
    progress: settled(results[4], 'progress'),
    worklogs: settled(results[5], 'worklogs'),
    activity: settled(results[6], 'activity'),
    attachments: settled(results[7], 'attachments'),
    sprints: settled(results[8], 'sprints'),
    customFields: settled(results[9], 'customFields'),
  };
}

/**
 * Hydrate the Issues List view in a single call.
 * Fetches issues (with filters), board columns, sprints, saved filters,
 * and custom field definitions in parallel.
 * @param projectId - The project to list issues for
 * @param filters - Query string filters (q, type, priority, etc.)
 * @param userId - The requesting user (for saved filters)
 */
export async function hydrateIssuesList(
  projectId: string,
  filters: Record<string, string>,
  userId: string,
) {
  const issueFilters: {
    q?: string;
    type?: string;
    priority?: string;
    assigneeId?: string;
    columnId?: string;
    sprintId?: string;
    label?: string;
    limit?: number;
    offset?: number;
    currentUserId?: string;
  } = {};

  if (filters.q) issueFilters.q = filters.q;
  if (filters.type) issueFilters.type = filters.type;
  if (filters.priority) issueFilters.priority = filters.priority;
  if (filters.assigneeId) issueFilters.assigneeId = filters.assigneeId;
  if (filters.columnId) issueFilters.columnId = filters.columnId;
  if (filters.sprintId) issueFilters.sprintId = filters.sprintId;
  if (filters.label) issueFilters.label = filters.label;
  const { take, skip } = parsePagination(
    { limit: filters.limit, offset: filters.offset },
    { limit: 25 },
  );
  issueFilters.limit = take;
  issueFilters.offset = skip;
  issueFilters.currentUserId = userId;

  const results = await Promise.allSettled([
    listIssues(projectId, issueFilters),
    getBoard(projectId),
    listSprints(projectId),
    listSavedFilters(userId, projectId),
    listFieldDefinitions(projectId),
  ]);

  // The list is what the caller asked for: its failure answers as issue.list does, where the rest
  // of this view may load in part
  if (results[0].status === 'rejected') throw results[0].reason;

  return {
    issues: results[0].value,
    boardColumns: settled(results[1], 'boardColumns'),
    sprints: settled(results[2], 'sprints'),
    savedFilters: settled(results[3], 'savedFilters'),
    customFields: settled(results[4], 'customFields'),
  };
}
