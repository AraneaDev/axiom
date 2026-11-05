import { z } from 'zod';

import { projectAction, projectRead } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';

import * as intakeService from './intake.service';
import {
  approveSubmissionSchema,
  listSubmissionsSchema,
  reviewSubmissionSchema,
} from './intake.validation';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });
const page = z.looseObject({});

const INTAKE = '/api/projects/:projectId/intake';
const SUBMISSION = `${INTAKE}/:submissionId`;

// Authorization runs on the ids alone (R10); every input extends its target (R11)
const projectTarget = z.object({ projectId: z.string() });
const submissionTarget = projectTarget.extend({ submissionId: z.string() });

type ProjectInput = z.infer<typeof projectTarget>;

const read = projectRead<ProjectInput>((input) => input.projectId);
// Reviewing follows the permission matrix: VIEWERs and GUESTs can read, not change
const write = projectAction<ProjectInput>('issue:edit', (input) => input.projectId);

// Approving, rejecting and marking spam change the submission's status and nothing is deleted
// (ruling B4)
registerActions([
  defineAction({
    name: 'intake.list',
    area: 'forms',
    kind: 'read',
    summary: 'List the form submissions waiting in a project, by status, with limit and offset',
    target: projectTarget,
    input: projectTarget.extend(listSubmissionsSchema.shape),
    output: page,
    rest: { method: 'GET', path: INTAKE },
    authorize: read,
    handler: async (_ctx, { projectId, ...query }) =>
      intakeService.listSubmissions(projectId, query),
  }),
  defineAction({
    name: 'intake.get',
    area: 'forms',
    kind: 'read',
    summary: 'Read one form submission',
    target: submissionTarget,
    input: submissionTarget,
    output: record,
    rest: { method: 'GET', path: SUBMISSION },
    authorize: read,
    handler: async (_ctx, { projectId, submissionId }) =>
      intakeService.getSubmission(submissionId, projectId),
  }),
  defineAction({
    name: 'intake.approve',
    area: 'forms',
    kind: 'write',
    summary: 'Approve a submission, which creates an issue from it',
    target: submissionTarget,
    input: submissionTarget.extend(approveSubmissionSchema.shape),
    output: record,
    rest: { method: 'POST', path: `${SUBMISSION}/approve`, status: 200 },
    authorize: write,
    handler: async (ctx, { projectId, submissionId, ...data }) =>
      intakeService.approveSubmission(submissionId, projectId, ctx.userId, data),
  }),
  defineAction({
    name: 'intake.reject',
    area: 'forms',
    kind: 'write',
    summary: 'Reject a pending submission, with a note',
    target: submissionTarget,
    input: submissionTarget.extend(reviewSubmissionSchema.shape),
    output: record,
    rest: { method: 'POST', path: `${SUBMISSION}/reject`, status: 200 },
    authorize: write,
    handler: async (ctx, { projectId, submissionId, reviewNote }) =>
      intakeService.rejectSubmission(submissionId, projectId, ctx.userId, reviewNote),
  }),
  defineAction({
    name: 'intake.markSpam',
    area: 'forms',
    kind: 'write',
    summary: 'Mark a submission as spam',
    target: submissionTarget,
    input: submissionTarget,
    output: record,
    rest: { method: 'POST', path: `${SUBMISSION}/spam`, status: 200, emptyBody: true },
    authorize: write,
    handler: async (ctx, { projectId, submissionId }) =>
      intakeService.markSpam(submissionId, projectId, ctx.userId),
  }),
]);
