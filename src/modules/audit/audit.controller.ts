import { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../utils/asyncHandler';

import * as auditService from './audit.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
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
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const log = await auditService.getAuditLog(req.params.id as string);
  if (!log) throw new AppError(404, 'Audit log not found', 'NOT_FOUND');
  res.json(log);
});
