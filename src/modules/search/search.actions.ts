import { z } from 'zod';

import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { hasQueryClauses } from '../../lib/query-engine';
import { scopeAllows } from '../../middleware/token-scopes';
import { savedSearchSchema, searchSchema } from '../../utils/validation';

import { queryRunOutput } from './query.actions';
import { limitSearch, runQuery } from './query.service';
import * as searchService from './search.service';
import { searchForAgent } from './search.service';

// Responses keep the shape the REST routes always had (R3)
const loose = z.looseObject({});
const noTarget = z.object({});
const savedTarget = z.object({ id: z.string().min(1).max(64) });

const searchActions = [
  defineAction({
    name: 'search.results',
    area: 'search',
    kind: 'read',
    summary:
      'Search issues and wiki pages as the search page does: sections with the full items, ' +
      'filters by team, project, space, label and dates, and paging by limit and offset. ' +
      'search.run is the compact form',
    target: noTarget,
    input: noTarget.extend(searchSchema.shape),
    output: z.array(z.object({ type: z.string(), total: z.number(), items: z.array(z.unknown()) })),
    rest: { method: 'GET', path: '/api/search' },
    // Results are filtered to what the user could open, and sections to what the token covers
    authorize: async () => {},
    handler: async (ctx, params) => {
      const results = await searchService.search({ ...params, userId: ctx.userId });
      // An API token only searches the areas its scopes cover
      const { scopes } = ctx;
      return scopes
        ? results.filter((section) =>
            scopeAllows(scopes, section.type === 'issues' ? 'issues' : 'wiki', 'read'),
          )
        : results;
    },
  }),
  defineAction({
    name: 'searchSpace.list',
    area: 'search',
    kind: 'read',
    summary: 'List the wiki spaces you may search, for the search filter',
    target: noTarget,
    input: noTarget,
    output: z.array(loose),
    rest: { method: 'GET', path: '/api/search/spaces' },
    authorize: async () => {},
    handler: async (ctx) => {
      // Space names are wiki data: search:read alone doesn't show them to a token
      if (ctx.scopes && !scopeAllows(ctx.scopes, 'wiki', 'read')) return [];
      return searchService.getAccessibleSpaces(ctx.userId);
    },
  }),
  defineAction({
    name: 'savedSearch.list',
    area: 'search',
    kind: 'read',
    summary: 'List your saved searches of the search page, newest first',
    target: noTarget,
    input: noTarget,
    output: z.array(z.looseObject({ id: z.string() })),
    rest: { method: 'GET', path: '/api/search/saved' },
    authorize: async () => {},
    handler: async (ctx) => searchService.getSavedSearches(ctx.userId),
  }),
  defineAction({
    name: 'savedSearch.create',
    // The search page's presets: a browser session saves them, a token has savedQuery.create
    uiOnly: true,
    noOrg: true,
    area: 'search',
    kind: 'write',
    summary: 'Save a search of the search page under a name',
    target: noTarget,
    input: noTarget.extend(savedSearchSchema.shape),
    output: z.looseObject({ id: z.string() }),
    rest: { method: 'POST', path: '/api/search/saved' },
    authorize: async () => {},
    handler: async (ctx, { name, query }) =>
      searchService.createSavedSearch(ctx.userId, { name, query }),
  }),
  defineAction({
    name: 'savedSearch.delete',
    destructive: true,
    uiOnly: true,
    noOrg: true,
    area: 'search',
    kind: 'write',
    summary: 'Delete one of your saved searches of the search page',
    target: savedTarget,
    input: savedTarget,
    output: z.void(),
    rest: { method: 'DELETE', path: '/api/search/saved/:id' },
    authorize: async () => {},
    handler: async (ctx, { id }) => {
      await searchService.deleteSavedSearch(id, ctx.userId);
    },
  }),
  defineAction({
    name: 'search.run',
    area: 'search',
    kind: 'read',
    summary:
      'Search issues and wiki pages. Takes free text and filters such as type:bug, status:done or ' +
      'assignee:name. A page titled exactly the query comes first. A query with SELECT, WHERE, ' +
      'GROUP BY or ORDER BY answers as query.run does.',
    input: z.object({
      query: z.string().min(1).max(1000),
      type: z.enum(['issues', 'wiki', 'all']).default('all'),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    output: z.union([
      z.array(
        z.looseObject({ type: z.string(), total: z.number(), items: z.array(z.looseObject({})) }),
      ),
      queryRunOutput,
    ]),
    // Results are filtered to what the user could open, and sections to what the token covers
    authorize: async () => {},
    handler: async (ctx, { query, type, limit }) => {
      await limitSearch(ctx.userId);
      // A query covers issues, so one who asked for the wiki gets the text search they asked for
      if (type !== 'wiki' && hasQueryClauses(query)) return runQuery(ctx, { query, limit });
      const covers = (area: 'issues' | 'wiki') =>
        !ctx.scopes || scopeAllows(ctx.scopes, area, 'read');
      return searchForAgent({
        q: query,
        limit,
        userId: ctx.userId,
        issues: type !== 'wiki' && covers('issues'),
        wiki: type !== 'issues' && covers('wiki'),
      });
    },
  }),
];

registerActions(searchActions);
