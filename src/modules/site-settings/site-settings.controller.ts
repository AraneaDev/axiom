import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../utils/validation/common-validators';

import { updateSiteSettingsSchema } from './site-settings.routes';
import * as siteSettingsService from './site-settings.service';

export const getSiteSettings = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await siteSettingsService.getSiteSettings();
  res.json(settings);
});

export const updateSiteSettings = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(updateSiteSettingsSchema, req.body);
  const settings = await siteSettingsService.updateSiteSettings(body);
  res.json(settings);
});
