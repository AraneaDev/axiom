import { Request, Response, NextFunction } from 'express';

import { parsePagination } from '../../utils/pagination';
import { param } from '../../utils/params';
import { validate, adminUpdateUserSchema, adminResetPasswordSchema } from '../../utils/validation';

import * as adminService from './admin.service';

/**
 *
 * @param _req
 * @param res
 * @param next
 */
export async function getStats(_req: Request, res: Response, next: NextFunction) {
  try {
    const stats = await adminService.getSystemStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function listUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const search = req.query.search as string | undefined;
    const { take, skip } = parsePagination(req.query as Record<string, string>);

    const result = await adminService.listUsers({ search, limit: take, offset: skip });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function getUser(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = param(req, 'userId');
    const user = await adminService.getUser(userId);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function updateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = param(req, 'userId');
    const body = validate(adminUpdateUserSchema, req.body);
    const user = await adminService.updateUser(userId, body);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function deleteUser(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = param(req, 'userId');
    const result = await adminService.deleteUser(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function deactivateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await adminService.deactivateUser(param(req, 'userId'));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function reactivateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await adminService.reactivateUser(param(req, 'userId'));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function resetUserPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = param(req, 'userId');
    const { newPassword } = validate(adminResetPasswordSchema, req.body);
    const result = await adminService.resetUserPassword(userId, newPassword);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param _req
 * @param res
 * @param next
 */
export async function getSettings(_req: Request, res: Response, next: NextFunction) {
  try {
    const settings = adminService.getSystemSettings();
    res.json(settings);
  } catch (err) {
    next(err);
  }
}
