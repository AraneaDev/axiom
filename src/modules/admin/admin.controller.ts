import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { parseServicePagination } from '../../utils/pagination';
import { param } from '../../utils/params';
import {
  validate,
  adminListUsersQuerySchema,
  adminUpdateUserSchema,
  adminResetPasswordSchema,
} from '../../utils/validation';

import * as adminService from './admin.service';

export const getStats = asyncHandler(async (_req: Request, res: Response) => {
  const stats = await adminService.getSystemStats();
  res.json(stats);
});

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const query = validate(adminListUsersQuerySchema, req.query);
  const { take, skip } = parseServicePagination({ limit: query.limit, offset: query.offset });
  const result = await adminService.listUsers({
    search: query.search,
    limit: take,
    offset: skip,
  });
  res.json(result);
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const userId = param(req, 'userId');
  const user = await adminService.getUser(userId);
  res.json(user);
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const userId = param(req, 'userId');
  const body = validate(adminUpdateUserSchema, req.body);
  const user = await adminService.updateUser(userId, body);
  res.json(user);
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const userId = param(req, 'userId');
  const result = await adminService.deleteUser(userId);
  res.json(result);
});

export const deactivateUser = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.deactivateUser(param(req, 'userId'));
  res.json(result);
});

export const reactivateUser = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.reactivateUser(param(req, 'userId'));
  res.json(result);
});

export const resetUserPassword = asyncHandler(async (req: Request, res: Response) => {
  const userId = param(req, 'userId');
  const { newPassword } = validate(adminResetPasswordSchema, req.body);
  const result = await adminService.resetUserPassword(userId, newPassword);
  res.json(result);
});

export const getSettings = asyncHandler(async (_req: Request, res: Response) => {
  const settings = adminService.getSystemSettings();
  res.json(settings);
});
