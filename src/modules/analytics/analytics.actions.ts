import { z } from 'zod';

import { orgPermission, projectRead, teamRead } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { firstQueryText, queryText } from '../../utils/validation';
import { getProjectAnalytics } from '../projects/projects.service';

import * as analyticsService from './analytics.service';

// Responses keep the shape the REST routes always had (R3)
const analytics = z.looseObject({});

const orgTarget = z.object({ orgId: z.string() });
const teamTarget = z.object({ teamId: z.string() });
const projectTarget = z.object({ projectId: z.string() });

registerActions([
  defineAction({
    name: 'analytics.org',
    // The route sits under /api/orgs, so the org scope opens it, as it always did
    area: 'orgs',
    kind: 'read',
    summary: 'Read the analytics of an organization over a period: 7d, 30d, 90d or quarter',
    target: orgTarget,
    input: orgTarget.extend({ period: queryText }),
    output: analytics,
    rest: { method: 'GET', path: '/api/orgs/:orgId/analytics' },
    authorize: orgPermission<z.infer<typeof orgTarget>>('issue:view', (input) => input.orgId),
    handler: async (ctx, { orgId, period }) =>
      analyticsService.getOrgAnalytics(
        orgId,
        analyticsService.parsePeriod(firstQueryText(period)),
        ctx.userId,
      ),
  }),
  defineAction({
    name: 'analytics.team',
    area: 'issues',
    kind: 'read',
    summary: 'Read the analytics of a team over a period: 7d, 30d, 90d or quarter',
    target: teamTarget,
    input: teamTarget.extend({ period: queryText }),
    output: analytics,
    rest: { method: 'GET', path: '/api/teams/:teamId/analytics' },
    authorize: teamRead<z.infer<typeof teamTarget>>((input) => input.teamId),
    handler: async (_ctx, { teamId, period }) =>
      analyticsService.getTeamAnalytics(
        teamId,
        analyticsService.parsePeriod(firstQueryText(period)),
      ),
  }),
  defineAction({
    name: 'analytics.project',
    area: 'issues',
    kind: 'read',
    summary:
      'Read the analytics of a project: issues by status, over time, cycle time and workload',
    target: projectTarget,
    input: projectTarget,
    output: analytics,
    rest: { method: 'GET', path: '/api/projects/:projectId/analytics' },
    authorize: projectRead<z.infer<typeof projectTarget>>((input) => input.projectId),
    handler: async (_ctx, { projectId }) => getProjectAnalytics(projectId),
  }),
]);
