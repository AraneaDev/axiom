import { z } from 'zod';

import { projectAction } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';

import * as roadmapService from './roadmap.service';
import { setIssueBucketSchema, setIssueDatesSchema } from './roadmap.validation';

const ISSUE = '/api/projects/:projectId/roadmap/issues/:issueId';

// Authorization runs on the ids alone (R10); every input extends its target (R11)
const target = z.object({ projectId: z.string(), issueId: z.string() });
const record = z.looseObject({ id: z.string() });

// The rule of the roadmap's other writes (requireProjectWrite in roadmap.routes.ts)
const write = projectAction<z.infer<typeof target>>('issue:edit', ({ projectId }) => projectId);

registerActions([
  defineAction({
    name: 'roadmap.setIssueBucket',
    area: 'issues',
    kind: 'write',
    summary: 'Move an issue to a roadmap bucket of its project, or out of any with null',
    target,
    input: target.extend(setIssueBucketSchema.shape),
    output: record,
    rest: { method: 'PATCH', path: `${ISSUE}/bucket` },
    authorize: write,
    handler: async (_ctx, { projectId, issueId, bucketId }) =>
      roadmapService.setIssueBucket(projectId, issueId, bucketId),
  }),
  defineAction({
    name: 'roadmap.setIssueDates',
    area: 'issues',
    kind: 'write',
    summary: 'Set the start and due date of an issue on the roadmap; null clears one',
    target,
    input: target.extend(setIssueDatesSchema.shape),
    output: record,
    rest: { method: 'PATCH', path: `${ISSUE}/dates` },
    authorize: write,
    handler: async (_ctx, { projectId, issueId, ...dates }) =>
      roadmapService.setIssueDates(projectId, issueId, dates),
  }),
]);
