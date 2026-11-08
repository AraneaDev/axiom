import { z } from 'zod';

import { projectAction, projectRead, teamRead } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import { inputPlace } from '../../actions/places';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';

import * as roadmapService from './roadmap.service';
import {
  bucketsViewQuerySchema,
  createBucketSchema,
  reorderBucketsSchema,
  setIssueBucketSchema,
  setIssueDatesSchema,
  timelineQuerySchema,
  updateBucketSchema,
} from './roadmap.validation';
import * as teamRoadmapService from './team-roadmap.service';
import { teamTimelineQuerySchema } from './team-roadmap.validation';

const ROADMAP = '/api/projects/:projectId/roadmap';
const BUCKETS = `${ROADMAP}/buckets`;
const BUCKET = `${BUCKETS}/:bucketId`;
const ISSUE = `${ROADMAP}/issues/:issueId`;

// Authorization runs on the ids alone (R10); every input extends its target (R11)
const target = z.object({ projectId: z.string(), issueId: z.string() });
const record = z.looseObject({ id: z.string() });
const loose = z.looseObject({});
const nothing = z.void();
const projectTarget = z.object({ projectId: z.string() });
const bucketTarget = projectTarget.extend({ bucketId: z.string() });
const teamTarget = z.object({ teamId: z.string() });

// The rule of the roadmap's other writes (requireProjectWrite in roadmap.routes.ts)
const write = projectAction<z.infer<typeof target>>('issue:edit', ({ projectId }) => projectId);

const readProject = projectRead<z.infer<typeof projectTarget>>(({ projectId }) => projectId);
const writeProject = projectAction<z.infer<typeof projectTarget>>(
  'issue:edit',
  ({ projectId }) => projectId,
);

// The static bucket paths (defaults, reorder, the views) come before the one with an id.
registerActions([
  defineAction({
    name: 'roadmapBucket.list',
    area: 'issues',
    kind: 'read',
    summary: 'List the roadmap buckets of a project',
    target: projectTarget,
    input: projectTarget,
    output: z.array(loose),
    rest: { method: 'GET', path: BUCKETS },
    authorize: readProject,
    handler: async (_ctx, { projectId }) => roadmapService.listBuckets(projectId),
  }),
  defineAction({
    name: 'roadmapBucket.create',
    place: inputPlace,
    area: 'issues',
    kind: 'write',
    summary: 'Add a roadmap bucket to a project',
    target: projectTarget,
    input: projectTarget.extend(createBucketSchema.shape),
    output: record,
    rest: { method: 'POST', path: BUCKETS },
    authorize: writeProject,
    handler: async (_ctx, { projectId, ...data }) => roadmapService.createBucket(projectId, data),
  }),
  defineAction({
    name: 'roadmapBucket.createDefaults',
    place: inputPlace,
    area: 'issues',
    kind: 'write',
    summary: 'Add the default roadmap buckets to a project',
    target: projectTarget,
    input: projectTarget,
    output: z.array(loose),
    rest: { method: 'POST', path: `${BUCKETS}/defaults`, emptyBody: true },
    authorize: writeProject,
    handler: async (_ctx, { projectId }) => roadmapService.createDefaultBuckets(projectId),
  }),
  defineAction({
    name: 'roadmapBucket.reorder',
    place: inputPlace,
    area: 'issues',
    kind: 'write',
    summary: 'Put the roadmap buckets of a project in the order of the ids given',
    target: projectTarget,
    input: projectTarget.extend(reorderBucketsSchema.shape),
    output: z.array(loose),
    rest: { method: 'POST', path: `${BUCKETS}/reorder`, status: 200 },
    authorize: writeProject,
    handler: async (_ctx, { projectId, bucketIds }) =>
      roadmapService.reorderBuckets(projectId, bucketIds),
  }),
  defineAction({
    name: 'roadmapBucket.update',
    place: inputPlace,
    area: 'issues',
    kind: 'write',
    summary: 'Change the name, color or position of a roadmap bucket',
    target: bucketTarget,
    input: bucketTarget.extend(updateBucketSchema.shape),
    output: record,
    rest: { method: 'PATCH', path: BUCKET },
    authorize: writeProject,
    handler: async (_ctx, { projectId, bucketId, ...data }) =>
      roadmapService.updateBucket(projectId, bucketId, data),
  }),
  defineAction({
    name: 'roadmapBucket.delete',
    place: inputPlace,
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'Delete a roadmap bucket; its issues are left without one',
    target: bucketTarget,
    input: bucketTarget,
    output: nothing,
    preview: (_ctx, { projectId, bucketId }) => previews.roadmapBucketDelete(projectId, bucketId),
    rest: { method: 'DELETE', path: BUCKET },
    authorize: writeProject,
    handler: async (_ctx, { projectId, bucketId }) =>
      roadmapService.deleteBucket(projectId, bucketId),
  }),
  defineAction({
    name: 'roadmap.timeline',
    area: 'issues',
    kind: 'read',
    summary: 'Read the timeline of a project, optionally filtered',
    target: projectTarget,
    input: projectTarget.extend(timelineQuerySchema.shape),
    output: loose,
    rest: { method: 'GET', path: `${ROADMAP}/timeline` },
    authorize: readProject,
    handler: async (_ctx, { projectId, ...filters }) =>
      roadmapService.getTimelineData(projectId, filters),
  }),
  defineAction({
    name: 'roadmap.bucketsView',
    area: 'issues',
    kind: 'read',
    summary: 'Read the issues of a project grouped by roadmap bucket, optionally filtered',
    target: projectTarget,
    input: projectTarget.extend(bucketsViewQuerySchema.shape),
    output: loose,
    rest: { method: 'GET', path: `${ROADMAP}/buckets-view` },
    authorize: readProject,
    handler: async (_ctx, { projectId, ...filters }) =>
      roadmapService.getBucketsViewData(projectId, filters),
  }),
  defineAction({
    name: 'teamRoadmap.timeline',
    area: 'issues',
    kind: 'read',
    summary: 'Read the timeline across the projects of a team, optionally filtered',
    target: teamTarget,
    input: teamTarget.extend(teamTimelineQuerySchema.shape),
    output: loose,
    rest: { method: 'GET', path: '/api/teams/:teamId/roadmap/timeline' },
    authorize: teamRead<z.infer<typeof teamTarget>>(({ teamId }) => teamId),
    handler: async (_ctx, { teamId, ...filters }) =>
      teamRoadmapService.getTeamTimelineData(teamId, filters),
  }),
  defineAction({
    name: 'roadmap.setIssueBucket',
    place: inputPlace,
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
    place: inputPlace,
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
