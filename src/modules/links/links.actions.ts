import { z } from 'zod';

import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';
import { queryText } from '../../utils/validation';

import { resolveLink } from './resolve-link.service';

const noTarget = z.object({});

registerActions([
  defineAction({
    name: 'link.resolve',
    area: 'issues',
    kind: 'read',
    summary: 'Turn the URL of an issue or wiki page of Axiom into a link preview',
    target: noTarget,
    input: noTarget.extend({ url: queryText }),
    output: z.looseObject({ title: z.string() }),
    rest: { method: 'GET', path: '/api/links/resolve-link' },
    // The preview only shows what the caller may open: the service checks each record
    authorize: async () => {},
    handler: async (ctx, { url }) => {
      if (typeof url !== 'string' || url === '') {
        throw new AppError(400, 'url query parameter required');
      }
      const preview = await resolveLink(url, ctx.userId);
      if (!preview) throw new AppError(404, 'Could not resolve link');
      return { ...preview };
    },
  }),
]);
