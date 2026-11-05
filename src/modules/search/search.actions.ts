import { z } from 'zod';

import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { hasQueryClauses } from '../../lib/query-engine';
import { scopeAllows } from '../../middleware/token-scopes';

import { queryRunOutput } from './query.actions';
import { limitSearch, runQuery } from './query.service';
import { searchForAgent } from './search.service';

const searchActions = [
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
