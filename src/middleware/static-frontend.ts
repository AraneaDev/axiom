import fs from 'fs';
import path from 'path';

import express, { Express } from 'express';

import { logger } from '../utils/logger';

/**
 * True for paths the API owns: `/api`, the `/ws` upgrade and `/health`.
 * Everything else is the served frontend (assets and client routes).
 * @param p request path without the query string
 */
export function isBackendPath(p: string): boolean {
  return (
    p === '/api' || p.startsWith('/api/') || p === '/ws' || p.startsWith('/ws/') || p === '/health'
  );
}

/**
 * Directory holding the built SPA: `STATIC_DIR`, else `public` next to `dist/` (or `src/`).
 * @param configured
 */
export function resolveStaticDir(configured?: string): string {
  return configured ? path.resolve(configured) : path.resolve(__dirname, '..', '..', 'public');
}

/**
 * Serve the built SPA from Express: hashed assets with a one-year immutable cache,
 * `index.html` never cached, and an index.html fallback for client-side routes.
 * Must be mounted after every `/api` route and before the error handler.
 * Returns false (and mounts nothing) when the directory has no index.html.
 * @param app
 * @param dir
 */
export function mountStaticFrontend(app: Express, dir: string): boolean {
  const indexFile = path.join(dir, 'index.html');
  if (!fs.existsSync(indexFile)) {
    logger.warn('Frontend not served: index.html missing', { dir });
    return false;
  }

  app.use(
    express.static(dir, {
      index: false,
      setHeaders(res, filePath) {
        const rel = path.relative(dir, filePath).split(path.sep);
        if (rel[0] === 'assets') {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (rel.join('/') === 'index.html') {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  app.get('/{*path}', (req, res, next) => {
    const p = req.path;
    // /api, /ws and /health belong to the API; a missing hashed asset is a real 404.
    if (isBackendPath(p)) return next();
    if (p.startsWith('/assets/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });

  return true;
}
