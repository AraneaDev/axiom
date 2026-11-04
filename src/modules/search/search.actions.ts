import { z } from 'zod';

import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { perUserLimit, SEARCH_LIMIT } from '../../middleware/rate-limit';
import { scopeAllows } from '../../middleware/token-scopes';

import { searchForAgent } from './search.service';

/** GET /api/search has searchLimiter per address; this action is reached by name, so per user. */
const limitSearch = perUserLimit(SEARCH_LIMIT, 'Too many search requests, please try again later');

const searchActions = [
  defineAction({
    name: 'search.run',
    area: 'search',
    kind: 'read',
    summary:
      'Search issues and wiki pages. Takes free text and filters such as type:bug, status:done or ' +
      'assignee:name. A page titled exactly the query comes first.',
    input: z.object({
      query: z.string().min(1).max(1000),
      type: z.enum(['issues', 'wiki', 'all']).default('all'),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    output: z.array(
      z.looseObject({ type: z.string(), total: z.number(), items: z.array(z.looseObject({})) }),
    ),
    // Results are filtered to what the user could open, and sections to what the token covers
    authorize: async () => {},
    handler: async (ctx, { query, type, limit }) => {
      await limitSearch(ctx.userId);
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
