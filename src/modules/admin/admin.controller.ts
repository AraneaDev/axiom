import { Request, Response, NextFunction } from 'express';

import { parsePagination } from '../../utils/pagination';
import { param } from '../../utils/params';

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
    const user = await adminService.updateUser(userId, req.body);
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
