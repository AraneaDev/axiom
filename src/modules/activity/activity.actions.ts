import { z } from 'zod';

import { projectRead } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';
import { ERR } from '../../utils/error-messages';
import { parsePagination } from '../../utils/pagination';
import { firstQueryText, queryCount, strictInt } from '../../utils/validation';

import * as activityService from './activity.service';

// Responses keep the shape the REST routes always had (R3)
const activities = z.looseObject({ activities: z.array(z.looseObject({})), total: z.number() });

const projectTarget = z.object({ projectId: z.string() });
const paging = { limit: queryCount, offset: queryCount };

const read = projectRead<z.infer<typeof projectTarget>>((input) => input.projectId);

registerActions([
  defineAction({
    name: 'activity.listProject',
    area: 'issues',
    kind: 'read',
    summary: 'List the activity on the issues of a project, newest first, paged',
    target: projectTarget,
    input: projectTarget.extend(paging),
    output: activities,
    rest: { method: 'GET', path: '/api/projects/:projectId/activity' },
    authorize: read,
    handler: async (_ctx, { projectId, limit, offset }) => {
      const { take, skip } = parsePagination({
        limit: firstQueryText(limit),
        offset: firstQueryText(offset),
      });
      return activityService.listActivities({ projectId, limit: take, offset: skip });
    },
  }),
  defineAction({
    name: 'activity.listIssue',
    area: 'issues',
    kind: 'read',
    summary: 'List the activity on one issue, newest first, paged',
    target: projectTarget,
    input: projectTarget.extend({ issueNumber: strictInt, ...paging }),
    output: activities,
    rest: { method: 'GET', path: '/api/projects/:projectId/issues/:issueNumber/activity' },
    authorize: read,
    handler: async (_ctx, { projectId, issueNumber, limit, offset }) => {
      const issueId = await activityService.getIssueIdByNumber(projectId, issueNumber);
      if (!issueId) throw new AppError(404, ERR.ISSUE_NOT_FOUND);
      const { take, skip } = parsePagination({
        limit: firstQueryText(limit),
        offset: firstQueryText(offset),
      });
      return activityService.listActivities({
        resourceType: 'issue',
        resourceId: issueId,
        limit: take,
        offset: skip,
      });
    },
  }),
]);
