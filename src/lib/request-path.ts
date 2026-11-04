import type { Request } from 'express';
import parseurl from 'parseurl';

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
