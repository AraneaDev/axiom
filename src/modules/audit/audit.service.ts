import { prisma } from '../../config/database';
import { attributionFields } from '../../lib/request-context';
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

  return prisma.auditLog.create({
    data: {
      ...attributionFields(),
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

  return { logs: await withUserNames(logs), total };
}

/**
 * Add who did it by name, and their kind so a bot shows as one. The table has no relation to users: a log outlives its user, whose
 * name then is null and only the id remains.
 * @param logs - The rows
 */
async function withUserNames<T extends { userId: string | null }>(logs: T[]) {
  const ids = [...new Set(logs.flatMap((log) => (log.userId ? [log.userId] : [])))];
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, displayName: true, kind: true },
  });
  const byId = new Map(users.map((user) => [user.id, user]));
  return logs.map((log) => {
    const user = log.userId ? byId.get(log.userId) : undefined;
    return { ...log, userName: user?.displayName || null, userKind: user?.kind ?? null };
  });
}

/**
 * Get a single audit log entry by ID.
 * @param id
 */
export async function getAuditLog(id: string) {
  const log = await prisma.auditLog.findUnique({ where: { id } });
  return log && (await withUserNames([log]))[0];
}
