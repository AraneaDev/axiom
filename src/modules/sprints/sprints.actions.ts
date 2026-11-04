import { z } from 'zod';

import { ownedByProject, projectAction, projectRead } from '../../actions/authorize';
import { defineAction, type ActionContext } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { projectOf } from '../../middleware/requireProjectAccess';
import {
  addSprintIssuesSchema,
  completeSprintSchema,
  createSprintSchema,
  updateSprintSchema,
} from '../../utils/validation';
import { hydrateBacklog } from '../issues/backlog-hydrate.service';

import * as sprintReportService from './sprint-report.service';
import * as sprintsService from './sprints.service';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });
const loose = z.looseObject({});
const nothing = z.void();

const PROJECT = '/api/projects/:projectId';
const SPRINT = `${PROJECT}/sprints/:sprintId`;

// Authorization runs on the ids alone (R10); every input extends its target (R11)
const projectTarget = z.object({ projectId: z.string() });
const sprintTarget = projectTarget.extend({ sprintId: z.string() });
const sprintIssueTarget = sprintTarget.extend({ issueId: z.string() });

type ProjectInput = z.infer<typeof projectTarget>;
type SprintInput = z.infer<typeof sprintTarget>;
type SprintIssueInput = z.infer<typeof sprintIssueTarget>;

const readProject = projectRead<ProjectInput>((input) => input.projectId);
const writeProject = projectAction<ProjectInput>('issue:edit', (input) => input.projectId);
const sprintOf = (input: SprintInput) => ({ projectId: input.projectId, recordId: input.sprintId });
const readSprint = ownedByProject(projectOf.sprint, sprintOf);
const writeSprint = ownedByProject(projectOf.sprint, sprintOf, 'issue:edit');
const issueOwnedByProject = ownedByProject(projectOf.issue, (input: SprintIssueInput) => ({
  projectId: input.projectId,
  recordId: input.issueId,
}));

/**
 * The sprint must belong to the project and so must the issue under it, as the router-level
 * requireOwnedByProject checks did.
 * @param ctx - Who runs the action
 * @param input - The ids
 */
async function writeSprintAndIssue(ctx: ActionContext, input: SprintIssueInput): Promise<void> {
  await writeSprint(ctx, input);
  await issueOwnedByProject(ctx, input);
}

const sprintActions = [
  defineAction({
    name: 'sprint.create',
    area: 'sprints',
    kind: 'write',
    summary: 'Create a sprint in a project',
    target: projectTarget,
    input: projectTarget.extend(createSprintSchema.shape),
    output: record,
    rest: { method: 'POST', path: `${PROJECT}/sprints` },
    authorize: writeProject,
    handler: async (_ctx, { projectId, ...data }) => sprintsService.createSprint(projectId, data),
  }),
  defineAction({
    name: 'sprint.list',
    area: 'sprints',
    kind: 'read',
    summary: 'List the sprints of a project, optionally by status',
    target: projectTarget,
    // Any query value passes, as it did before: a repeated ?status= reaches the service unchanged
    input: projectTarget.extend({ status: z.unknown() }),
    output: z.array(loose),
    rest: { method: 'GET', path: `${PROJECT}/sprints` },
    authorize: readProject,
    handler: async (_ctx, { projectId, status }) =>
      sprintsService.listSprints(projectId, { status: status as string | undefined }),
  }),
  defineAction({
    name: 'sprint.get',
    area: 'sprints',
    kind: 'read',
    summary: 'Read one sprint',
    target: sprintTarget,
    input: sprintTarget,
    output: record,
    rest: { method: 'GET', path: SPRINT },
    authorize: readSprint,
    handler: async (_ctx, { sprintId }) => sprintsService.getSprint(sprintId),
  }),
  defineAction({
    name: 'sprint.update',
    area: 'sprints',
    kind: 'write',
    summary: 'Change the name, goal or dates of a sprint',
    target: sprintTarget,
    input: sprintTarget.extend(updateSprintSchema.shape),
    output: record,
    rest: { method: 'PATCH', path: SPRINT },
    authorize: writeSprint,
    handler: async (_ctx, { projectId: _projectId, sprintId, ...data }) =>
      sprintsService.updateSprint(sprintId, data),
  }),
  defineAction({
    name: 'sprint.start',
    area: 'sprints',
    kind: 'write',
    summary: 'Start a planned sprint',
    target: sprintTarget,
    input: sprintTarget,
    output: record,
    rest: { method: 'POST', path: `${SPRINT}/start`, status: 200, emptyBody: true },
    authorize: writeSprint,
    handler: async (_ctx, { sprintId }) => sprintsService.startSprint(sprintId),
  }),
  defineAction({
    name: 'sprint.complete',
    area: 'sprints',
    kind: 'write',
    summary: 'Complete a sprint, moving open issues to another sprint or the backlog',
    target: sprintTarget,
    input: sprintTarget.extend(completeSprintSchema.shape),
    output: record,
    rest: { method: 'POST', path: `${SPRINT}/complete`, status: 200 },
    authorize: writeSprint,
    handler: async (_ctx, { sprintId, moveToSprintId }) =>
      sprintsService.completeSprint(sprintId, moveToSprintId),
  }),
  defineAction({
    name: 'sprint.report',
    area: 'sprints',
    kind: 'read',
    summary: 'The report of a sprint: scope, burndown, what got done',
    target: sprintTarget,
    input: sprintTarget,
    output: z.looseObject({
      sprint: record,
      summary: loose,
      completedIssues: z.array(z.unknown()),
      incompleteIssues: z.array(z.unknown()),
      scopeChanges: z.array(z.unknown()),
    }),
    rest: { method: 'GET', path: `${SPRINT}/report` },
    authorize: readSprint,
    // The spread turns the report's interface into a plain object for the loose output schema
    handler: async (_ctx, { projectId, sprintId }) => ({
      ...(await sprintReportService.getSprintReport(projectId, sprintId)),
    }),
  }),
  defineAction({
    name: 'sprint.addIssues',
    area: 'sprints',
    kind: 'write',
    summary: 'Add issues to a sprint',
    target: sprintTarget,
    input: sprintTarget.extend(addSprintIssuesSchema.shape),
    output: record,
    rest: { method: 'POST', path: `${SPRINT}/issues`, status: 200 },
    authorize: writeSprint,
    handler: async (_ctx, { sprintId, issueIds }) =>
      sprintsService.addIssuesToSprint(sprintId, issueIds),
  }),
  defineAction({
    name: 'sprint.removeIssues',
    area: 'sprints',
    kind: 'write',
    summary: 'Take an issue out of a sprint',
    target: sprintIssueTarget,
    input: sprintIssueTarget,
    output: nothing,
    rest: { method: 'DELETE', path: `${SPRINT}/issues/:issueId` },
    authorize: writeSprintAndIssue,
    handler: async (_ctx, { issueId }) => {
      await sprintsService.removeIssueFromSprint(issueId);
    },
  }),
  defineAction({
    name: 'sprint.velocity',
    area: 'sprints',
    kind: 'read',
    summary: 'Velocity of the last sprints of a project',
    target: projectTarget,
    // Any query value passes, as it did before: a repeated ?count= is read as its first number
    input: projectTarget.extend({ count: z.unknown() }),
    output: z.array(loose),
    rest: { method: 'GET', path: `${PROJECT}/velocity` },
    authorize: readProject,
    handler: async (_ctx, { projectId, count }) =>
      sprintsService.getVelocity(projectId, count ? parseInt(count as string, 10) : undefined),
  }),
  defineAction({
    name: 'sprint.backlogHydrate',
    area: 'sprints',
    kind: 'read',
    summary: 'The backlog view in one call: backlog, sprints, columns',
    target: projectTarget,
    input: projectTarget,
    output: loose,
    rest: { method: 'GET', path: `${PROJECT}/backlog/hydrate` },
    authorize: readProject,
    handler: async (_ctx, { projectId }) => hydrateBacklog(projectId),
  }),
  defineAction({
    name: 'sprint.backlog',
    area: 'sprints',
    kind: 'read',
    summary: 'Issues of a project that are in no sprint',
    target: projectTarget,
    input: projectTarget,
    output: z.array(loose),
    rest: { method: 'GET', path: `${PROJECT}/backlog` },
    authorize: readProject,
    handler: async (_ctx, { projectId }) => sprintsService.getBacklog(projectId),
  }),
];

registerActions(sprintActions);
