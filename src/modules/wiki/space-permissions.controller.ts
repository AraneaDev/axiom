import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate, setSpacePermissionSchema } from '../../utils/validation';

import * as spacePermService from './space-permissions.service';

/**
 * List all permissions for a space.
 */
export const listPermissions = asyncHandler(async (req: Request, res: Response) => {
  const permissions = await spacePermService.getSpacePermissions(param(req, 'spaceId'));
  res.json(permissions);
});

/**
 * Upsert a permission on a space.
 */
export const upsertPermission = asyncHandler(async (req: Request, res: Response) => {
  const { userId, teamRole, level } = validate(setSpacePermissionSchema, req.body);
  const permission = await spacePermService.setSpacePermission(param(req, 'spaceId'), {
    userId,
    teamRole,
    level,
  });
  res.json(permission);
});

/**
 * Delete a permission from a space.
 */
export const deletePermission = asyncHandler(async (req: Request, res: Response) => {
  await spacePermService.removeSpacePermission(param(req, 'spaceId'), param(req, 'permissionId'));
  res.status(204).send();
});
