import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate, setRestrictionsSchema } from '../../utils/validation';

import * as permissionsService from './wiki-permissions.service';

/**
 * Get all restrictions for a page.
 */
export const getRestrictions = asyncHandler(async (req: Request, res: Response) => {
  const restrictions = await permissionsService.getRestrictions(param(req, 'pageId'));
  res.json(restrictions);
});

/**
 * Set restrictions on a page (replaces existing restrictions of the given type).
 */
export const setRestrictions = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(setRestrictionsSchema, req.body);
  await permissionsService.setRestrictions(param(req, 'pageId'), data.type, data.userIds);
  const restrictions = await permissionsService.getRestrictions(param(req, 'pageId'));
  res.json(restrictions);
});

/**
 * Remove a single restriction by ID.
 */
export const removeRestriction = asyncHandler(async (req: Request, res: Response) => {
  await permissionsService.removeRestriction(param(req, 'restrictionId'));
  res.status(204).send();
});
