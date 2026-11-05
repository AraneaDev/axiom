import type { RequestHandler } from 'express';
import { z } from 'zod';

import { definePublicAction, type PublicActionContext } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';
import { publicFormLimiter } from '../../middleware/rate-limit';

import { clientKey } from './client-ip';
import * as formsService from './forms.service';
import { submitFormSchema, verifyFormSchema } from './forms.validation';

/**
 * The public side of the forms: anyone with a form's link, no account. These run with no user
 * (ctx.userId is undefined and must never be read) and never for a token (ruling B9). Each keeps
 * the per-IP limiter it always had.
 */
const nothing = z.void();
const record = z.looseObject({});

const PUBLIC_FORM = '/api/f/:slug';

const slugTarget = z.object({ slug: z.string().min(1).max(200) });

/**
 * A GET carrying a secret is a guess like verify: the same per-IP limiter. One without is not.
 * @param req - The request
 * @param res - The response
 * @param next - Continues to the action
 */
const limitSecretGuesses: RequestHandler = (req, res, next) => {
  if (req.get('X-Form-Secret')) return publicFormLimiter(req, res, next);
  next();
};

/**
 * The sender's IP, as the per-IP form limits key it.
 * @param ctx - The context, which holds the request's IP
 */
const clientIp = (ctx: PublicActionContext): string => clientKey(ctx.ipAddress || 'unknown');

registerActions([
  definePublicAction({
    name: 'publicForm.get',
    uiOnly: true,
    area: 'forms',
    kind: 'read',
    summary:
      'Read a published form by its slug, for the public page. A gated form shows only enough ' +
      'to ask for its secret, sent in the X-Form-Secret header',
    target: slugTarget,
    input: slugTarget,
    output: nothing,
    // Raw: the secret comes in a header and the locked answer is a different shape
    rest: {
      method: 'GET',
      path: PUBLIC_FORM,
      raw: true,
      public: true,
      rateLimit: limitSecretGuesses,
    },
    authorize: async () => {},
    handler: async (ctx, { slug }) => {
      const http = ctx.http;
      if (!http) throw new AppError(500, 'The public form needs the request');
      const { req, res } = http;
      const form = await formsService.getPublicForm(slug);
      // Strip sensitive fields
      const { sharedSecret: _secret, ...publicForm } = form as typeof form & {
        sharedSecret?: string;
      };
      if (form.authMode === 'TOKEN_GATED') {
        // Without the secret (X-Form-Secret header) a gated form shows only enough to ask for it
        const secret = req.get('X-Form-Secret');
        let authorized = false;
        if (secret) {
          try {
            await formsService.assertFormSecret(form, secret, clientIp(ctx));
            authorized = true;
          } catch (err) {
            // A lockout is reported as such; a wrong secret just keeps the form locked
            if (err instanceof AppError && err.statusCode === 429) throw err;
            authorized = false;
          }
        }
        if (!authorized) {
          res.json({
            id: form.id,
            name: form.name,
            slug: form.slug,
            authMode: form.authMode,
            locked: true,
          });
          return;
        }
      }
      res.json({ ...publicForm, authMode: form.authMode });
    },
  }),
  definePublicAction({
    name: 'publicForm.submit',
    uiOnly: true,
    area: 'forms',
    kind: 'write',
    summary: 'Submit a published form by its slug, for the public page',
    target: slugTarget,
    input: slugTarget.extend(submitFormSchema.shape),
    output: record,
    rest: {
      method: 'POST',
      path: `${PUBLIC_FORM}/submit`,
      public: true,
      rateLimit: publicFormLimiter,
    },
    authorize: async () => {},
    handler: async (ctx, { slug, data, submitterEmail, submitterName, honeypot, secret }) => {
      const submission = await formsService.submitForm(
        slug,
        data,
        submitterEmail,
        submitterName,
        clientIp(ctx),
        honeypot,
        secret,
      );
      return { id: submission.id, status: submission.status };
    },
  }),
  definePublicAction({
    name: 'publicForm.verify',
    uiOnly: true,
    area: 'forms',
    kind: 'read',
    summary: 'Check the secret of a gated form, for the public page',
    target: slugTarget,
    input: slugTarget.extend(verifyFormSchema.shape),
    output: record,
    rest: {
      method: 'POST',
      path: `${PUBLIC_FORM}/verify`,
      status: 200,
      public: true,
      rateLimit: publicFormLimiter,
    },
    authorize: async () => {},
    handler: async (ctx, { slug, secret }) =>
      formsService.verifyFormAccess(slug, secret, clientIp(ctx)),
  }),
]);
