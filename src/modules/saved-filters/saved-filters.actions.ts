import { z } from 'zod';

import { defineAction, type ActionContext } from '../../actions/define';
import { orgsOfSavedQuery } from '../../actions/org-lookups';
import { inputOrOrgPlace, savedQueryPlace } from '../../actions/places';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { savedQueryUpdate } from '../../actions/sharing-previews';
import { queryRunOutput } from '../search/query.actions';
import { limitSearch, QUERY_ITEM_FIELDS, runQuery } from '../search/query.service';

import * as savedFiltersService from './saved-filters.service';

// Responses keep the shape the REST routes always had, plus the sharing fields (R3)
const record = z.looseObject({ id: z.string() });
const nothing = z.void();

const SAVED = '/api/saved-filters';

// Authorization runs on the id alone (R10); every input extends its target (R11)
const noTarget = z.object({});
const savedTarget = z.object({ filterId: z.string().min(1).max(64) });

const NAME_MAX = 200;
const DESCRIPTION_MAX = 1000;
const TEXT_MAX = 1000;
const id = z.string().min(1).max(64);

/** The query as a UI filter record (the issue list) or as text in the query language */
const queryFields = {
  query: z
    .record(z.string().max(100), z.string().max(1000))
    .optional()
    .describe('A filter record saved by the issue list. Give this or text'),
  text: z
    .string()
    .min(1)
    .max(TEXT_MAX)
    .optional()
    .describe('The query in the query language, as query.run takes it. Give this or query'),
};

const sharingFields = {
  visibility: z
    .enum(['PRIVATE', 'TEAM', 'ORG'])
    .optional()
    .describe('Who can open it. PRIVATE: you; TEAM: the team in teamId; ORG: the org in orgId'),
  teamId: id.optional(),
  orgId: id.optional(),
};

/**
 * Throw unless the caller may change the saved query.
 * @param ctx - Who runs the action
 * @param target - The saved query's id
 * @param target.filterId
 */
async function authorizeEdit(ctx: ActionContext, target: { filterId: string }): Promise<void> {
  await savedFiltersService.loadFor(ctx.userId, target.filterId, 'edit');
}

const savedFilterActions = [
  defineAction({
    name: 'savedQuery.list',
    area: 'dashboards',
    kind: 'read',
    summary:
      'List the saved queries you made and those shared with your teams and orgs, ' +
      'optionally for one project',
    target: noTarget,
    input: noTarget.extend({ projectId: id.optional() }),
    output: z.array(record),
    rest: { method: 'GET', path: SAVED },
    // The list is cut to what the caller may open in the service
    authorize: async () => {},
    handler: async (ctx, { projectId }) => savedFiltersService.list(ctx.userId, projectId),
  }),
  defineAction({
    name: 'savedQuery.get',
    area: 'dashboards',
    kind: 'read',
    summary: 'Read one saved query you may open',
    target: savedTarget,
    input: savedTarget,
    output: record,
    rest: { method: 'GET', path: `${SAVED}/:filterId` },
    authorize: async (ctx, { filterId }) => {
      await savedFiltersService.loadFor(ctx.userId, filterId, 'view');
    },
    handler: async (ctx, { filterId }) => savedFiltersService.get(ctx.userId, filterId),
  }),
  defineAction({
    name: 'savedQuery.create',
    place: inputOrOrgPlace,
    area: 'dashboards',
    kind: 'write',
    summary:
      'Save a query under a name. Give text (a query as query.run takes it). It is private ' +
      'unless visibility is TEAM (with teamId) or ORG (with orgId) and you belong to it. ' +
      'Whoever opens a shared query runs it with their own rights.',
    target: noTarget,
    input: noTarget.extend({
      name: z.string().min(1).max(NAME_MAX),
      description: z.string().max(DESCRIPTION_MAX).optional(),
      projectId: id.optional(),
      ...queryFields,
      ...sharingFields,
    }),
    output: record,
    rest: { method: 'POST', path: SAVED, status: 201 },
    // Anyone may save for themselves; sharing is checked against membership in the service
    authorize: async () => {},
    handler: async (ctx, input) =>
      savedFiltersService.create(ctx.userId, {
        name: input.name,
        description: input.description,
        projectId: input.projectId,
        body: { query: input.query, text: input.text },
        sharing: {
          visibility: input.visibility ?? 'PRIVATE',
          teamId: input.teamId,
          orgId: input.orgId,
        },
      }),
  }),
  defineAction({
    name: 'savedQuery.update',
    place: savedQueryPlace,
    permissionChange: ({ visibility, teamId, orgId }) =>
      visibility !== undefined || teamId !== undefined || orgId !== undefined,
    preview: (ctx, { filterId, ...rest }) => savedQueryUpdate(ctx.userId, filterId, rest),
    orgIds: (_ctx, { filterId }) => orgsOfSavedQuery(filterId),
    area: 'dashboards',
    kind: 'write',
    summary:
      'Change a saved query: name, description, query or text, and who it is shared with. ' +
      'The creator may, and for TEAM that team admins, for ORG the org owners and admins.',
    target: savedTarget,
    input: savedTarget.extend({
      name: z.string().min(1).max(NAME_MAX).optional(),
      description: z.string().max(DESCRIPTION_MAX).nullable().optional(),
      ...queryFields,
      ...sharingFields,
    }),
    output: record,
    rest: { method: 'PATCH', path: `${SAVED}/:filterId` },
    authorize: authorizeEdit,
    handler: async (ctx, input) =>
      savedFiltersService.update(ctx.userId, input.filterId, {
        name: input.name,
        description: input.description,
        body: { query: input.query, text: input.text },
        sharing: { visibility: input.visibility, teamId: input.teamId, orgId: input.orgId },
      }),
  }),
  defineAction({
    name: 'savedQuery.delete',
    place: savedQueryPlace,
    orgIds: (_ctx, { filterId }) => orgsOfSavedQuery(filterId),
    destructive: true,
    area: 'dashboards',
    kind: 'write',
    summary: 'Delete a saved query you may change',
    target: savedTarget,
    input: savedTarget,
    output: nothing,
    rest: { method: 'DELETE', path: `${SAVED}/:filterId` },
    preview: (_ctx, { filterId }) => previews.savedQueryDelete(filterId),
    authorize: authorizeEdit,
    handler: async (ctx, { filterId }) => {
      await savedFiltersService.remove(ctx.userId, filterId);
    },
  }),
  defineAction({
    name: 'savedQuery.run',
    area: 'dashboards',
    kind: 'read',
    summary:
      'Run a saved query you may open, as query.run does and with your own rights: ' +
      'a shared query shows you what you can see, not what its creator can',
    target: savedTarget,
    input: savedTarget.extend({
      limit: z.number().int().min(1).max(500).default(50),
      cursor: z.string().min(1).max(64).optional(),
      fields: z.array(z.enum(QUERY_ITEM_FIELDS)).optional(),
    }),
    output: queryRunOutput,
    rest: { method: 'POST', path: `${SAVED}/:filterId/run`, status: 200, optionalBody: true },
    authorize: async (ctx, { filterId }) => {
      await savedFiltersService.loadFor(ctx.userId, filterId, 'view');
    },
    handler: async (ctx, input) => {
      await limitSearch(ctx.userId);
      const { text, projectId } = await savedFiltersService.textToRun(ctx.userId, input.filterId);
      // The token needs issues:read besides its own area; runQuery checks that (P9)
      return runQuery(ctx, {
        query: text,
        limit: input.limit,
        cursor: input.cursor,
        fields: input.fields,
        scope: projectId ? { projectId } : undefined,
      });
    },
  }),
];

registerActions(savedFilterActions);
