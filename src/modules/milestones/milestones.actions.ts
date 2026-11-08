import { z } from 'zod';

import { projectAction, projectRead, recordInProject } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import { orgsOfMilestone } from '../../actions/org-lookups';
import { inputPlace, milestonePlace } from '../../actions/places';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { ERR } from '../../utils/error-messages';
import { createMilestoneSchema, updateMilestoneSchema } from '../../utils/validation';

import * as milestonesService from './milestones.service';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });
const list = z.array(z.looseObject({}));
const nothing = z.void();

const MILESTONES = '/api/projects/:projectId/milestones';
const MILESTONE = '/api/projects/milestones/:milestoneId';

// Authorization runs on the ids alone (R10); every input extends its target (R11)
const projectTarget = z.object({ projectId: z.string() });
const milestoneTarget = z.object({ milestoneId: z.string() });

type ProjectInput = z.infer<typeof projectTarget>;
type MilestoneInput = z.infer<typeof milestoneTarget>;

const readProject = projectRead<ProjectInput>((input) => input.projectId);
// Milestones follow the permission matrix: VIEWERs and GUESTs can read, not change
const writeProject = projectAction<ProjectInput>('issue:edit', (input) => input.projectId);
// By id the user needs access to the milestone's project
const readMilestone = recordInProject<MilestoneInput>(
  milestonesService.milestoneProjectId,
  ERR.MILESTONE_NOT_FOUND,
  (input) => input.milestoneId,
);
const writeMilestone = recordInProject<MilestoneInput>(
  milestonesService.milestoneProjectId,
  ERR.MILESTONE_NOT_FOUND,
  (input) => input.milestoneId,
  ['issue:edit'],
);

// The milestone path comes first: it is the static one.
registerActions([
  defineAction({
    name: 'milestone.get',
    area: 'issues',
    kind: 'read',
    summary: 'Read one milestone',
    target: milestoneTarget,
    input: milestoneTarget,
    output: record,
    rest: { method: 'GET', path: MILESTONE },
    authorize: readMilestone,
    handler: async (_ctx, { milestoneId }) => milestonesService.getMilestone(milestoneId),
  }),
  defineAction({
    name: 'milestone.update',
    place: milestonePlace,
    area: 'issues',
    kind: 'write',
    summary: 'Change the title, description, due date or status of a milestone',
    target: milestoneTarget,
    input: milestoneTarget.extend(updateMilestoneSchema.shape),
    output: record,
    orgIds: (_ctx, { milestoneId }) => orgsOfMilestone(milestoneId),
    rest: { method: 'PATCH', path: MILESTONE },
    authorize: writeMilestone,
    handler: async (_ctx, { milestoneId, ...data }) =>
      milestonesService.updateMilestone(milestoneId, data),
  }),
  defineAction({
    name: 'milestone.delete',
    place: milestonePlace,
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'Delete a milestone',
    target: milestoneTarget,
    input: milestoneTarget,
    output: nothing,
    orgIds: (_ctx, { milestoneId }) => orgsOfMilestone(milestoneId),
    preview: (_ctx, { milestoneId }) => previews.milestoneDelete(milestoneId),
    rest: { method: 'DELETE', path: MILESTONE },
    authorize: writeMilestone,
    handler: async (_ctx, { milestoneId }) => milestonesService.deleteMilestone(milestoneId),
  }),
  defineAction({
    name: 'milestone.create',
    place: inputPlace,
    area: 'issues',
    kind: 'write',
    summary: 'Create a milestone in a project',
    target: projectTarget,
    input: projectTarget.extend(createMilestoneSchema.shape),
    output: record,
    rest: { method: 'POST', path: MILESTONES },
    authorize: writeProject,
    handler: async (_ctx, { projectId, ...data }) =>
      milestonesService.createMilestone(projectId, data),
  }),
  defineAction({
    name: 'milestone.list',
    area: 'issues',
    kind: 'read',
    summary: 'List the milestones of a project',
    target: projectTarget,
    input: projectTarget,
    output: list,
    rest: { method: 'GET', path: MILESTONES },
    authorize: readProject,
    handler: async (_ctx, { projectId }) => milestonesService.listMilestones(projectId),
  }),
]);
