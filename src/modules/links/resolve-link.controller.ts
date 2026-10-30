import type { Request, Response } from 'express';

import { resolveLink } from './resolve-link.service';

/**
 * GET /api/links/resolve-link?url=...
 * Resolves an Axiom URL into a rich link preview.
 * @param req
 * @param res
 */
export async function resolveLinkHandler(req: Request, res: Response) {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: { message: 'url query parameter required' } });
    return;
  }

  const preview = await resolveLink(url, req.userId!);

  if (!preview) {
    res.status(404).json({ error: { message: 'Could not resolve link' } });
    return;
  }

  res.json(preview);
}
