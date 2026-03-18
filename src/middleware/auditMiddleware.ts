import { Request, Response, NextFunction } from 'express';

import { logAudit } from '../modules/audit/audit.service';

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
  [/\/api\/repos/, 'repo'],
  [/\/api\/wiki/, 'wiki_page'],
  [/\/api\/users/, 'user'],
  [/\/api\/notifications/, 'notification'],
  [/\/api\/attachments/, 'attachment'],
  [/\/api\/saved-filters/, 'saved_filter'],
  [/\/api\/search/, 'search'],
];

function resolveResourceType(path: string): string {
  // Check specific sub-paths first
  if (/\/pulls/.test(path)) return 'pull_request';
  if (/\/issues/.test(path)) return 'issue';
  if (/\/releases/.test(path)) return 'release';
  if (/\/pipelines/.test(path)) return 'pipeline';
  if (/\/webhooks/.test(path)) return 'webhook';
  if (/\/protection/.test(path)) return 'branch_protection';

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

  res.on('finish', () => {
    // Only log successful requests (2xx)
    if (res.statusCode < 200 || res.statusCode >= 300) return;

    const resourceType = resolveResourceType(req.originalUrl);
    const resourceId = extractResourceId(req.originalUrl);
    const ipAddress =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';

    // Fire-and-forget: do not block the response
    logAudit({
      userId: req.userId,
      action,
      resourceType,
      resourceId,
      ipAddress,
      details: {
        method,
        path: req.originalUrl,
        statusCode: res.statusCode,
      },
    }).catch(() => {
      // Silently ignore audit log failures to avoid disrupting normal operations
    });
  });

  next();
}
