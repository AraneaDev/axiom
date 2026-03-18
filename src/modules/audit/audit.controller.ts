import { Request, Response, NextFunction } from 'express';

import { AppError } from '../../middleware/errorHandler';

import * as auditService from './audit.service';

/**
 * GET /admin/audit-logs
 * @param req
 * @param res
 * @param next
 */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, resourceType, action, startDate, endDate, limit, offset } = req.query;

    const result = await auditService.listAuditLogs({
      userId: userId as string | undefined,
      resourceType: resourceType as string | undefined,
      action: action as string | undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /admin/audit-logs/:id
 * @param req
 * @param res
 * @param next
 */
export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const log = await auditService.getAuditLog(req.params.id as string);
    if (!log) throw new AppError(404, 'Audit log not found', 'NOT_FOUND');
    res.json(log);
  } catch (err) {
    next(err);
  }
}
