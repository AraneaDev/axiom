import { prisma } from '../../config/database';
import { getRequestContext } from '../../lib/request-context';
import { parseServicePagination } from '../../utils/pagination';

export interface LogAuditData {
  userId?: string;
  orgId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

export interface ListAuditLogsOpts {
  orgId?: string;
  userId?: string;
  resourceType?: string;
  action?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Create an audit log entry.
 * @param data
 */
export async function logAudit(data: LogAuditData) {
  const resource = data.resourceId ? `${data.resourceType}:${data.resourceId}` : data.resourceType;

  const ctx = getRequestContext();

  return prisma.auditLog.create({
    data: {
      apiTokenId: ctx?.apiTokenId ?? null,
      via: ctx?.apiTokenName ?? null,
      orgId: data.orgId ?? 'system',
      userId: data.userId ?? null,
      action: data.action,
      resource,
      details: {
        ...(data.details ?? {}),
        ...(data.ipAddress ? { ipAddress: data.ipAddress } : {}),
      },
    },
  });
}

/**
 * Query audit logs with filters.
 * @param opts
 */
export async function listAuditLogs(opts: ListAuditLogsOpts) {
  const where: Record<string, unknown> = {};

  if (opts.orgId) where.orgId = opts.orgId;
  if (opts.userId) where.userId = opts.userId;
  if (opts.action) where.action = { contains: opts.action };
  if (opts.resourceType) where.resource = { startsWith: opts.resourceType };

  if (opts.startDate || opts.endDate) {
    const createdAt: Record<string, Date> = {};
    if (opts.startDate) createdAt.gte = opts.startDate;
    if (opts.endDate) createdAt.lte = opts.endDate;
    where.createdAt = createdAt;
  }

  const { take, skip } = parseServicePagination(opts, 50);

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { logs, total };
}

/**
 * Get a single audit log entry by ID.
 * @param id
 */
export async function getAuditLog(id: string) {
  return prisma.auditLog.findUnique({ where: { id } });
}
