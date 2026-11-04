import { createHash } from 'crypto';

import { apiReference } from '@scalar/express-api-reference';
import { Router, type RequestHandler } from 'express';

import { buildOpenApi } from './build';

const router = Router();

router.get('/openapi.json', (_req, res) => {
  res.json(buildOpenApi());
});

const scalar = apiReference({ url: '/api/openapi.json' });

/**
 * Let the docs page run its own scripts. The page loads the Scalar bundle from a CDN and starts it
 * with an inline script, which the app's Content-Security-Policy (script-src 'self') refuses. Only
 * this response is widened: the CDN's host and the hash of that one inline script.
 * @param req - The request
 * @param res - The response
 * @param next - Passed on to Scalar's handler
 */
const docsPage: RequestHandler<never, string> = (req, res, next) => {
  const send = res.send.bind(res);
  res.send = (body) => {
    const html = body ?? '';
    const policy = res.getHeader('Content-Security-Policy');
    const scripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)];
    const hashes = scripts.map(
      (script) => `'sha256-${createHash('sha256').update(script[1]).digest('base64')}'`,
    );
    const cdn = html.match(/<script[^>]*\ssrc="(https:\/\/[^/"]+)/)?.[1];
    if (typeof policy === 'string' && cdn) {
      res.setHeader(
        'Content-Security-Policy',
        policy.replace(/(^|;)(\s*script-src\s)([^;]*)/, `$1$2$3 ${cdn} ${hashes.join(' ')}`),
      );
    }
    return send(body);
  };
  scalar(req, res, next);
};

router.use('/docs', docsPage);

export { router as openApiRouter };
