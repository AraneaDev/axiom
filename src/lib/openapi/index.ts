import { createHash } from 'crypto';
import { createRequire } from 'module';
import path from 'path';

import { apiReference } from '@scalar/express-api-reference';
import express, { Router, type RequestHandler } from 'express';

import { buildOpenApi } from './build';

const router = Router();

router.get('/openapi.json', (_req, res) => {
  res.json(buildOpenApi());
});

/**
 * The Scalar bundle comes from the installed package and is served from the app's own origin, so
 * the docs page loads no third-party script (this origin holds the tokens in localStorage).
 */
const SCALAR_ASSETS = path.join(
  path.dirname(createRequire(__filename).resolve('@scalar/api-reference')),
  'browser',
);
const SCALAR_SCRIPT = '/api/docs/assets/standalone.js';
router.use('/docs/assets', express.static(SCALAR_ASSETS, { index: false, dotfiles: 'deny' }));

const scalar = apiReference({
  url: '/api/openapi.json',
  cdn: SCALAR_SCRIPT,
  // The default fonts come from a third-party host; the system fonts do
  withDefaultFonts: false,
  // Nothing may go to a third party from this origin
  telemetry: false,
  mcp: { disabled: true },
  hideClientButton: true,
  showDeveloperTools: 'never',
});

/**
 * Let the docs page run its inline start script, which the app's Content-Security-Policy
 * (script-src 'self') refuses. Only this response is widened, by the hash of that one script.
 * @param req - The request
 * @param res - The response
 * @param next - Passed on to Scalar's handler
 */
const docsPage: RequestHandler<never, string> = (req, res, next) => {
  const send = res.send.bind(res);
  res.send = (body) => {
    const html = body ?? '';
    const policy = res.getHeader('Content-Security-Policy');
    const hashes = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
      (script) => `'sha256-${createHash('sha256').update(script[1]).digest('base64')}'`,
    );
    if (typeof policy === 'string') {
      res.setHeader(
        'Content-Security-Policy',
        policy.replace(/(^|;)(\s*script-src\s)([^;]*)/, `$1$2$3 ${hashes.join(' ')}`),
      );
    }
    return send(body);
  };
  scalar(req, res, next);
};

router.use('/docs', docsPage);

export { router as openApiRouter };
