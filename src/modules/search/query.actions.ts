import { z } from 'zod';

import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';

import { limitSearch, QUERY_ITEM_FIELDS, runQuery } from './query.service';

const SCOPE_ID_MAX_LENGTH = 64;
const scopeId = z.string().min(1).max(SCOPE_ID_MAX_LENGTH).optional();

/** Authorization is the access filter inside the query, so authorize needs no id. */
const queryTarget = z.object({});

export const queryRunOutput = z.discriminatedUnion('kind', [
  z.looseObject({
    kind: z.literal('items'),
    items: z.array(z.looseObject({ id: z.string(), key: z.string() })),
    nextCursor: z.string().optional(),
  }),
  z.looseObject({
    kind: z.literal('groups'),
    groups: z.array(
      z.looseObject({
        key: z.looseObject({}),
        count: z.number(),
        sum: z.number().optional(),
        avg: z.number().nullable().optional(),
      }),
    ),
    /** Issues in all groups, also those past the limit */
    total: z.number(),
    truncated: z.literal(true).optional(),
  }),
]);

const queryActions = [
  defineAction({
    name: 'query.run',
    area: 'search',
    kind: 'read',
    summary:
      'Run a query over all issues you can see: [SELECT COUNT, SUM(storypoints), AVG(storypoints)] ' +
      '[WHERE] condition [GROUP BY field, field] [ORDER BY field DESC]. Keywords are in capitals. ' +
      'Without SELECT or GROUP BY it returns items; page them with nextCursor. Group by type, ' +
      'status, priority, assignee, creator, sprint, project, done or sprintstate.',
    target: queryTarget,
    input: queryTarget.extend({
      query: z.string().min(1).max(1000),
      limit: z.number().int().min(1).max(500).default(50),
      cursor: z.string().min(1).max(64).optional(),
      fields: z.array(z.enum(QUERY_ITEM_FIELDS)).optional(),
      scope: z.object({ orgId: scopeId, teamId: scopeId, projectId: scopeId }).optional(),
    }),
    output: queryRunOutput,
    rest: { method: 'POST', path: '/api/query', status: 200 },
    // Results are what the user could open; the token's issues:read is checked in runQuery (P9)
    authorize: async () => {},
    handler: async (ctx, input) => {
      await limitSearch(ctx.userId);
      return runQuery(ctx, input);
    },
  }),
];

registerActions(queryActions);
