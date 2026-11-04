import { Request, Response, NextFunction } from 'express';

import { prisma } from '../config/database';
import { ERR } from '../utils/error-messages';
import { param } from '../utils/params';
import type { Action } from '../utils/permissions';

import { AppError } from './errorHandler';
import { checkTeamPermission } from './rbac';

export type ProjectAccess = 'ok' | 'not_found' | 'forbidden';

/**
 * Decide whether a user can view a project: system admins always can, everyone else
 * needs a membership in the team that owns it. Shared by the REST middleware below and
 * the realtime room checks.
 * @param userId - The user to check
 * @param projectId - The project to check
 * @returns 'ok', 'not_found' when the project doesn't exist, or 'forbidden'
 */
export async function checkProjectAccess(
  userId: string,
  projectId: string,
): Promise<ProjectAccess> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { teamId: true },
  });
  if (!project) return 'not_found';

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (user?.isAdmin) return 'ok';

  const membership = await prisma.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId: project.teamId } },
  });
  return membership ? 'ok' : 'forbidden';
}

/**
 * Verifies the authenticated user is a member of the team that owns the project.
 * Expects `req.params.projectId` and `req.userId` (set by `authenticate`).
 * @param req
 * @param _res
 * @param next
 */
export async function requireProjectAccess(req: Request, _res: Response, next: NextFunction) {
  try {
    const access = await checkProjectAccess(req.userId!, param(req, 'projectId'));
    if (access === 'not_found') return next(new AppError(404, ERR.PROJECT_NOT_FOUND));
    if (access === 'forbidden') return next(new AppError(403, ERR.ACCESS_DENIED, 'FORBIDDEN'));
    next();
  } catch (err) {
    next(err);
  }
}

type ProjectResolver = (id: string) => Promise<string | null | undefined>;

/**
 * For routes nested under /:projectId: the record named by `paramName` must belong to that
 * project. requireProjectAccess only checks the project in the URL, so without this a
 * member of one project could reach another project's (or org's) records by id.
 * Answers 404, as if the record did not exist in this project.
 * @param paramName - The route param holding the record id
 * @param resolve - Returns the project ids the record belongs to (one, or several for links)
 * @returns Express middleware
 */
export function requireOwnedByProject(
  paramName: string,
  resolve: (id: string) => Promise<Array<string | null | undefined>>,
) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const owners = await resolve(param(req, paramName));
      if (!owners.includes(param(req, 'projectId'))) {
        return next(new AppError(404, 'Not found in this project'));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * For routes that name a project-owned record without /:projectId: resolve the record's
 * project, then apply the requireProjectAccess rule to it.
 * @param paramName - The route param holding the record id
 * @param resolve - Returns the record's project id, or null when it doesn't exist
 * @param notFound - The 404 message
 * @returns Express middleware
 */
export function requireProjectAccessVia(
  paramName: string,
  resolve: ProjectResolver,
  notFound: string,
) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const projectId = await resolve(param(req, paramName));
      if (!projectId) return next(new AppError(404, notFound));
      const access = await checkProjectAccess(req.userId!, projectId);
      if (access === 'not_found') return next(new AppError(404, notFound));
      if (access === 'forbidden') return next(new AppError(403, ERR.ACCESS_DENIED, 'FORBIDDEN'));
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Resolvers from a record id to the project(s) it belongs to. */
export const projectOf = {
  sprint: async (id: string) => [
    (await prisma.sprint.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  ],
  issue: async (id: string) => [
    (await prisma.issue.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  ],
  comment: async (id: string) => [
    (
      await prisma.comment.findUnique({
        where: { id },
        select: { issue: { select: { projectId: true } } },
      })
    )?.issue.projectId,
  ],
  issueWebLink: async (id: string) => [
    (
      await prisma.issueWebLink.findUnique({
        where: { id },
        select: { issue: { select: { projectId: true } } },
      })
    )?.issue.projectId,
  ],
  automationRule: async (id: string) => [
    (await prisma.automationRule.findUnique({ where: { id }, select: { projectId: true } }))
      ?.projectId,
  ],
  workflowRule: async (id: string) => [
    (await prisma.workflowRule.findUnique({ where: { id }, select: { projectId: true } }))
      ?.projectId,
  ],
  /**
   * A link belongs to the projects of both its issues
   * @param id
   */
  issueLink: async (id: string) => {
    const link = await prisma.issueLink.findUnique({
      where: { id },
      select: { from: { select: { projectId: true } }, to: { select: { projectId: true } } },
    });
    return [link?.from.projectId, link?.to.projectId];
  },
  form: async (id: string) => [
    (await prisma.form.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  ],
  formPage: async (id: string) => [
    (
      await prisma.formPage.findUnique({
        where: { id },
        select: { form: { select: { projectId: true } } },
      })
    )?.form.projectId,
  ],
  formField: async (id: string) => [
    (
      await prisma.formField.findUnique({
        where: { id },
        select: { page: { select: { form: { select: { projectId: true } } } } },
      })
    )?.page.form.projectId,
  ],
};

/**
 * Whether the user's role allows `action` on a project: platform admins always, otherwise
 * the org role or the role in the project's team (checkTeamPermission).
 * @param userId
 * @param projectId
 * @param action
 * @returns 'ok', 'not_found' or 'forbidden'
 */
export async function checkProjectAction(
  userId: string,
  projectId: string,
  action: Action,
): Promise<'ok' | 'not_found' | 'forbidden'> {
  const [user, project] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } }),
    prisma.project.findUnique({ where: { id: projectId }, select: { teamId: true } }),
  ]);
  if (!project) return 'not_found';
  if (user?.isAdmin) return 'ok';
  return (await checkTeamPermission(userId, project.teamId, action)) === 'ok' ? 'ok' : 'forbidden';
}

/**
 * Project actions beyond reading, such as changing settings or deleting the project: the
 * user's org role or their role in the project's team must allow `action`. Platform admins
 * pass. Use after requireProjectAccess.
 * @param action - The permission action, e.g. 'project:delete'
 * @returns Express middleware
 */
export function requireProjectAction(action: Action) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const access = await checkProjectAction(req.userId!, param(req, 'projectId'), action);
      if (access === 'not_found') return next(new AppError(404, ERR.PROJECT_NOT_FOUND));
      if (access === 'forbidden') {
        return next(new AppError(403, `Insufficient permissions: ${action}`, 'FORBIDDEN'));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Role check for every write under /:projectId, following the permission matrix: reads
 * pass through, writes need `action` (issue:edit by default; VIEWERs and GUESTs lack it).
 * Mount with router.use('/:projectId', ...). A first segment that is not a project id
 * (e.g. /milestones/:id) passes through to its own checks.
 * @param action - The action writes need
 * @returns Express middleware
 */
export function requireProjectWrite(action: Action = 'issue:edit') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    try {
      // Several project routers share /api/projects and each mounts this guard: decide once
      const key = `${param(req, 'projectId')}:${action}`;
      const checked = req as Request & { projectWriteChecked?: string };
      if (checked.projectWriteChecked === key) return next();
      const access = await checkProjectAction(req.userId!, param(req, 'projectId'), action);
      if (access === 'forbidden') {
        return next(new AppError(403, `Insufficient permissions: ${action}`, 'FORBIDDEN'));
      }
      checked.projectWriteChecked = key;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * requireProjectWrite for routes that name a project-owned record instead of the project.
 * @param paramName - The route param holding the record id
 * @param resolve - Returns the record's project id
 * @param action - The action writes need
 * @returns Express middleware
 */
export function requireProjectWriteVia(
  paramName: string,
  resolve: ProjectResolver,
  action: Action = 'issue:edit',
) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    try {
      const projectId = await resolve(param(req, paramName));
      if (!projectId) return next();
      if ((await checkProjectAction(req.userId!, projectId, action)) === 'forbidden') {
        return next(new AppError(403, `Insufficient permissions: ${action}`, 'FORBIDDEN'));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
