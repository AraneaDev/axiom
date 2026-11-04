import type { Request } from 'express';
import parseurl from 'parseurl';

import { normalizeApiPath } from '../middleware/token-scopes';

/**
 * The path of the request from the root, as Express routes it: no query, no fragment, and an
 * absolute request target reduced to its path. Use this for any decision on the path; splitting
 * `req.originalUrl` keeps a fragment that routing ignores. It reads originalUrl rather than
 * `req.url`, which inside a mounted router has lost the router's prefix.
 * @param req - The request
 */
export function requestPathname(req: Request): string {
  return parseurl.original(req)?.pathname ?? '/';
}

/**
 * The request URL for logs and the audit trail. On a signed upload the query is left out as a
 * whole: it holds a credential that still works if the request failed, and looking for its name
 * would miss any spelling the query parser accepts (`?%73ig=`).
 * @param req - The request
 */
export function loggableUrl(req: Request): string {
  const pathname = requestPathname(req);
  return normalizeApiPath(pathname).startsWith('/api/uploads') ? pathname : req.originalUrl;
}
