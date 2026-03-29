import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';

import { resolveWikiTemplate } from './wiki-template-resolver.service';

export const resolveTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { body, context } = req.body;
  const resolved = await resolveWikiTemplate(body, {
    ...context,
    userId: req.user!.id,
  });
  res.json({ body: resolved });
});
