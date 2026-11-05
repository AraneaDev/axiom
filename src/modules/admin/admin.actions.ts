import { z } from 'zod';

import { isToken } from '../../actions/approval-policy';
import { platformAdmin } from '../../actions/authorize';
import { defineAction, type ActionContext } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';
import { parsePagination, parseServicePagination } from '../../utils/pagination';
import {
  adminListUsersQuerySchema,
  adminResetPasswordSchema,
  adminUpdateUserSchema,
  firstQueryText,
  queryCount,
} from '../../utils/validation';
import * as auditService from '../audit/audit.service';

import * as adminService from './admin.service';

const record = z.looseObject({ id: z.string() });
const success = z.looseObject({ success: z.boolean() });

const noTarget = z.object({});
const userTarget = z.object({ userId: z.string() });

/** A date a query can filter on: Postgres would refuse anything else with a 500. */
const queryDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be a date')
  .optional();

/**
 * A token never deletes the account it belongs to, approved or not (A16): that stays a person's
 * own act in the web UI.
 * @param ctx - Who runs the action
 * @param input - The user to delete
 * @param input.userId
 */
async function notYourOwnAccount(ctx: ActionContext, { userId }: { userId: string }) {
  await platformAdmin(ctx);
  if (isToken(ctx) && userId === ctx.userId) {
    throw new AppError(
      403,
      "A token can't delete its own account: do this in the web UI",
      'FORBIDDEN',
    );
  }
}

// The whole installation: no org's rules bind these. Reads wait for a person too (A14)
registerActions([
  defineAction({
    name: 'admin.stats',
    admin: true,
    area: 'admin',
    kind: 'read',
    summary: 'Read the totals of this installation (platform admins)',
    input: noTarget,
    output: z.looseObject({ totalUsers: z.number(), totalOrgs: z.number() }),
    preview: () => previews.adminStats(),
    rest: { method: 'GET', path: '/api/admin/stats' },
    authorize: platformAdmin,
    handler: async () => adminService.getSystemStats(),
  }),
  defineAction({
    name: 'admin.settings',
    admin: true,
    area: 'admin',
    kind: 'read',
    summary: 'Read the settings of this installation (platform admins)',
    input: noTarget,
    output: z.looseObject({ version: z.string() }),
    preview: () => previews.adminSettings(),
    rest: { method: 'GET', path: '/api/admin/settings' },
    authorize: platformAdmin,
    handler: async () => adminService.getSystemSettings(),
  }),
  defineAction({
    name: 'adminUser.list',
    admin: true,
    area: 'admin',
    kind: 'read',
    summary: 'List or search the users of this installation (platform admins)',
    target: noTarget,
    input: noTarget.extend(adminListUsersQuerySchema.shape),
    output: z.looseObject({ users: z.array(record), total: z.number() }),
    preview: (_ctx, { search }) => previews.adminUserList(search),
    rest: { method: 'GET', path: '/api/admin/users' },
    authorize: platformAdmin,
    handler: async (_ctx, { search, limit, offset }) => {
      const { take, skip } = parseServicePagination({ limit, offset });
      return adminService.listUsers({ search, limit: take, offset: skip });
    },
  }),
  defineAction({
    name: 'adminUser.get',
    admin: true,
    area: 'admin',
    kind: 'read',
    summary: 'Read the account of one user (platform admins)',
    input: userTarget,
    output: record,
    preview: (_ctx, { userId }) => previews.adminUserGet(userId),
    rest: { method: 'GET', path: '/api/admin/users/:userId' },
    authorize: platformAdmin,
    handler: async (_ctx, { userId }) => adminService.getUser(userId),
  }),
  defineAction({
    name: 'adminUser.update',
    admin: true,
    noOrg: true,
    area: 'admin',
    kind: 'write',
    summary: "Set a user's role in every organization they are in (platform admins)",
    target: userTarget,
    input: userTarget.extend(adminUpdateUserSchema.shape),
    output: record,
    preview: (_ctx, { userId, role }) => previews.adminUserUpdate(userId, role),
    rest: { method: 'PATCH', path: '/api/admin/users/:userId' },
    authorize: platformAdmin,
    handler: async (_ctx, { userId, role }) => adminService.updateUser(userId, { role }),
  }),
  defineAction({
    name: 'adminUser.delete',
    admin: true,
    destructive: true,
    noOrg: true,
    area: 'admin',
    kind: 'write',
    summary: "Delete a user's account (platform admins)",
    input: userTarget,
    output: z.looseObject({ deleted: z.boolean() }),
    preview: (_ctx, { userId }) => previews.adminUserDelete(userId),
    rest: { method: 'DELETE', path: '/api/admin/users/:userId' },
    authorize: notYourOwnAccount,
    handler: async (_ctx, { userId }) => adminService.deleteUser(userId),
  }),
  defineAction({
    name: 'adminUser.deactivate',
    admin: true,
    noOrg: true,
    area: 'admin',
    kind: 'write',
    summary: 'Deactivate a user, who can then neither sign in nor use a token (platform admins)',
    input: userTarget,
    output: success,
    preview: (_ctx, { userId }) => previews.adminUserDeactivate(userId),
    rest: { method: 'POST', path: '/api/admin/users/:userId/deactivate', status: 200 },
    authorize: platformAdmin,
    handler: async (_ctx, { userId }) => adminService.deactivateUser(userId),
  }),
  defineAction({
    name: 'adminUser.reactivate',
    admin: true,
    noOrg: true,
    area: 'admin',
    kind: 'write',
    summary: 'Reactivate a user (platform admins)',
    input: userTarget,
    output: success,
    preview: (_ctx, { userId }) => previews.adminUserReactivate(userId),
    rest: { method: 'POST', path: '/api/admin/users/:userId/reactivate', status: 200 },
    authorize: platformAdmin,
    handler: async (_ctx, { userId }) => adminService.reactivateUser(userId),
  }),
  defineAction({
    name: 'adminUser.resetPassword',
    // Its input holds a password, which must not wait in a table for an approval (A4), so it never
    // reaches the gate and has no preview
    uiOnly: true,
    admin: true,
    noOrg: true,
    area: 'admin',
    kind: 'write',
    summary: 'Set a new password for a user. Only a platform admin, in the web UI',
    target: userTarget,
    input: userTarget.extend(adminResetPasswordSchema.shape),
    output: success,
    rest: { method: 'POST', path: '/api/admin/users/:userId/reset-password', status: 200 },
    authorize: platformAdmin,
    handler: async (_ctx, { userId, newPassword }) =>
      adminService.resetUserPassword(userId, newPassword),
  }),
  defineAction({
    name: 'auditLog.list',
    admin: true,
    area: 'admin',
    kind: 'read',
    summary: 'Read the audit log of this installation, newest first (platform admins)',
    target: noTarget,
    input: noTarget.extend({
      userId: z.string().optional(),
      resourceType: z.string().optional(),
      action: z.string().optional(),
      startDate: queryDate,
      endDate: queryDate,
      limit: queryCount,
      offset: queryCount,
    }),
    output: z.looseObject({ logs: z.array(record), total: z.number() }),
    preview: (_ctx, { userId, resourceType, action }) =>
      previews.auditLogList({ userId, resourceType, action }),
    rest: { method: 'GET', path: '/api/admin/audit-logs' },
    authorize: platformAdmin,
    handler: async (_ctx, { startDate, endDate, limit, offset, ...filters }) => {
      const { take, skip } = parsePagination(
        { limit: firstQueryText(limit), offset: firstQueryText(offset) },
        { limit: 50 },
      );
      return auditService.listAuditLogs({
        ...filters,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        limit: take,
        offset: skip,
      });
    },
  }),
  defineAction({
    name: 'auditLog.get',
    admin: true,
    area: 'admin',
    kind: 'read',
    summary: 'Read one row of the audit log (platform admins)',
    input: z.object({ id: z.string() }),
    output: record,
    preview: (_ctx, { id }) => previews.auditLogGet(id),
    rest: { method: 'GET', path: '/api/admin/audit-logs/:id' },
    authorize: platformAdmin,
    handler: async (_ctx, { id }) => {
      const log = await auditService.getAuditLog(id);
      if (!log) throw new AppError(404, 'Audit log not found', 'NOT_FOUND');
      return log;
    },
  }),
]);
