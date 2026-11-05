import { z } from 'zod';

import { projectAction, projectRead } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { dbInt, listPosition } from '../../utils/validation';

import * as boardColumnsService from './board-columns.service';
import * as issuesService from './issues.service';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });
const loose = z.looseObject({});
const nothing = z.void();

const PROJECT = '/api/projects/:projectId';
const COLUMNS = `${PROJECT}/board/columns`;
const COLUMN = `${COLUMNS}/:columnId`;

// Authorization runs on the ids alone (R10); every input extends its target (R11)
const projectTarget = z.object({ projectId: z.string() });
const columnTarget = projectTarget.extend({ columnId: z.string() });

type ProjectInput = z.infer<typeof projectTarget>;

const read = projectRead<ProjectInput>((input) => input.projectId);
// Board columns are project settings: team ADMINs, org OWNERs/ADMINs and platform admins only
const settings = projectAction<ProjectInput>('team:manage_members', (input) => input.projectId);

const wipLimit = dbInt.nullable().optional();

// The reorder path comes first: it is the static one.
registerActions([
  defineAction({
    name: 'board.get',
    area: 'boards',
    kind: 'read',
    summary: 'Read the board of a project: its columns with their issues',
    target: projectTarget,
    input: projectTarget,
    output: z.array(loose),
    rest: { method: 'GET', path: `${PROJECT}/board` },
    authorize: read,
    handler: async (_ctx, { projectId }) => issuesService.getBoard(projectId),
  }),
  defineAction({
    name: 'roadmap.get',
    area: 'issues',
    kind: 'read',
    summary: 'Read the issues of a project laid out for its roadmap',
    target: projectTarget,
    input: projectTarget,
    output: z.array(loose),
    rest: { method: 'GET', path: `${PROJECT}/roadmap` },
    authorize: read,
    handler: async (_ctx, { projectId }) => issuesService.getRoadmap(projectId),
  }),
  defineAction({
    name: 'boardColumn.create',
    area: 'boards',
    kind: 'write',
    summary: 'Add a column to the board of a project',
    target: projectTarget,
    input: projectTarget.extend({
      name: z.string().min(1),
      position: listPosition.optional(),
      isDone: z.boolean().optional(),
      wipLimit,
    }),
    output: record,
    rest: { method: 'POST', path: COLUMNS },
    authorize: settings,
    handler: async (_ctx, { projectId, ...data }) =>
      boardColumnsService.createColumn(projectId, data),
  }),
  defineAction({
    name: 'boardColumn.reorder',
    area: 'boards',
    kind: 'write',
    summary: 'Set the positions of the columns of a board',
    target: projectTarget,
    input: projectTarget.extend({
      positions: z.array(z.object({ id: z.string(), position: listPosition })),
    }),
    output: z.array(loose),
    rest: { method: 'PATCH', path: `${COLUMNS}/reorder` },
    authorize: settings,
    handler: async (_ctx, { projectId, positions }) =>
      boardColumnsService.reorderColumns(projectId, positions),
  }),
  defineAction({
    name: 'boardColumn.update',
    // A rename or a change of isDone changes what a column means to workflows, gates and reports.
    // That is destructive (ruling B3, B13): a token's call waits for approval, and an org's rules
    // may relax it. A limit alone does not wait
    destructiveWhen: ({ name, isDone }) => name !== undefined || isDone !== undefined,
    area: 'boards',
    kind: 'write',
    summary: 'Rename a column, mark it done or not, or set its work in progress limit',
    target: columnTarget,
    input: columnTarget.extend({
      name: z.string().optional(),
      isDone: z.boolean().optional(),
      wipLimit,
    }),
    output: record,
    preview: (_ctx, { projectId, columnId, ...fields }) =>
      previews.boardColumnUpdate(projectId, columnId, fields),
    rest: { method: 'PATCH', path: COLUMN },
    authorize: settings,
    handler: async (_ctx, { projectId, columnId, ...data }) =>
      boardColumnsService.updateColumn(projectId, columnId, data),
  }),
  defineAction({
    name: 'boardColumn.delete',
    destructive: true,
    area: 'boards',
    kind: 'write',
    summary: 'Delete an empty column from the board',
    target: columnTarget,
    input: columnTarget,
    output: nothing,
    preview: (_ctx, { projectId, columnId }) => previews.boardColumnDelete(projectId, columnId),
    rest: { method: 'DELETE', path: COLUMN },
    authorize: settings,
    handler: async (_ctx, { projectId, columnId }) =>
      boardColumnsService.deleteColumn(projectId, columnId),
  }),
]);
