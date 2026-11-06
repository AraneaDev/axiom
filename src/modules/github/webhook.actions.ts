import { z } from 'zod';

import { definePublicAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';

import * as service from './webhook.service';

const header = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

// GitHub calls this with no sign-in; the signature over the body is the credential. It covers the
// whole body, so there are no ids to authorize: the handler reads the raw bytes itself.
registerActions([
  definePublicAction({
    name: 'githubWebhook.receive',
    uiOnly: true,
    noOrg: true,
    area: 'github',
    kind: 'write',
    summary: 'Receive a GitHub webhook delivery, verified by its signature',
    input: z.object({}),
    output: z.looseObject({}),
    rest: {
      method: 'POST',
      path: '/api/github/webhook',
      public: true,
      raw: true,
      emptyBody: true,
    },
    authorize: async () => {},
    handler: async (ctx) => {
      if (!ctx.http) throw new AppError(400, 'Not a webhook request', 'BAD_REQUEST');
      const { req, res } = ctx.http;
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const result = await service.receive(raw, {
        signature: header(req.headers['x-hub-signature-256']),
        deliveryId: header(req.headers['x-github-delivery']),
        event: header(req.headers['x-github-event']),
      });
      res.status('duplicate' in result ? 200 : 202).json(result);
      return result;
    },
  }),
]);
