import { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../utils/asyncHandler';
import { parsePagination } from '../../utils/pagination';

import * as auditService from './audit.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { userId, resourceType, action, startDate, endDate } = req.query;
  const { take, skip } = parsePagination(req.query as { limit?: string; offset?: string }, {
    limit: 50,
  });

  const result = await auditService.listAuditLogs({
    userId: userId as string | undefined,
    resourceType: resourceType as string | undefined,
    action: action as string | undefined,
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined,
    limit: take,
    offset: skip,
  });

  res.json(result);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const log = await auditService.getAuditLog(req.params.id as string);
  if (!log) throw new AppError(404, 'Audit log not found', 'NOT_FOUND');
  res.json(log);
});
