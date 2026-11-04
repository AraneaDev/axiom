import { Request, Response, NextFunction } from 'express';

import { getRequestContext, runWithRequestContext } from '../lib/request-context';
import { loggableUrl, requestPathname } from '../lib/request-path';
import { logAudit } from '../modules/audit/audit.service';

import { normalizeApiPath } from './token-scopes';

/** One path, many actions: executeAction writes a row per action for these (R21). */
const AUDITED_PER_ACTION = new Set(['/api/mcp', '/api/act']);

const METHOD_ACTION_MAP: Record<string, string> = {
  POST: 'create',
  PATCH: 'update',
  PUT: 'update',
  DELETE: 'delete',
};

const PATH_RESOURCE_MAP: [RegExp, string][] = [
  [/\/api\/orgs/, 'org'],
  [/\/api\/teams/, 'team'],
  [/\/api\/projects/, 'project'],
  [/\/api\/wiki/, 'wiki_page'],
  [/\/api\/users/, 'user'],
  [/\/api\/notifications/, 'notification'],
  [/\/api\/attachments/, 'attachment'],
  [/\/api\/uploads/, 'attachment'],
  [/\/api\/saved-filters/, 'saved_filter'],
  [/\/api\/search/, 'search'],
];

function resolveResourceType(path: string): string {
  // Check specific sub-paths first
  if (/\/issues/.test(path)) return 'issue';

  for (const [pattern, resourceType] of PATH_RESOURCE_MAP) {
    if (pattern.test(path)) return resourceType;
  }

  return 'unknown';
}

function extractResourceId(path: string): string | undefined {
  // Try to extract the last path segment that looks like a cuid or numeric ID
  const segments = path.split('/').filter(Boolean);
  if (segments.length >= 2) {
    const last = segments[segments.length - 1];
    // cuid pattern or numeric
    if (/^[a-z0-9]{20,30}$/.test(last) || /^\d+$/.test(last)) {
      return last;
    }
  }
  return undefined;
}

/**
 * Express middleware that logs mutating requests after they complete successfully.
 * Apply AFTER route handlers via res.on('finish').
 * @param req
 * @param res
 * @param next
 */
export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  const action = METHOD_ACTION_MAP[method];

  // Only log mutating requests
  if (!action) {
    return next();
  }

  // The finish event fires outside the request's async chain, so keep the context object
  // (authenticate fills it in later) and re-enter it when the response is done.
  const ctx = getRequestContext();

  res.on('finish', () => {
    // Only log successful requests (2xx)
    if (res.statusCode < 200 || res.statusCode >= 300) return;

    const pathname = requestPathname(req);
    if (AUDITED_PER_ACTION.has(normalizeApiPath(pathname))) return;
    const resourceType = resolveResourceType(pathname);
    const resourceId = extractResourceId(pathname);
    const ipAddress =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';

    // Fire-and-forget: do not block the response
    const write = () =>
      logAudit({
        userId: req.userId,
        action,
        resourceType,
        resourceId,
        ipAddress,
        details: {
          method,
          path: loggableUrl(req),
          statusCode: res.statusCode,
        },
      });
    const pending = ctx ? runWithRequestContext(ctx, write) : write();
    pending.catch(() => {
      // Silently ignore audit log failures to avoid disrupting normal operations
    });
  });

  next();
}
