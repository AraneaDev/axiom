import crypto from 'crypto';

import type { RunnerScope } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { ERR } from '../../utils/error-messages';

/**
 *
 * @param scopeType
 * @param scopeId
 */
export async function generateRegistrationToken(scopeType: RunnerScope, scopeId: string) {
  const plainToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = await bcrypt.hash(plainToken, 10);

  const record = await prisma.runnerRegistrationToken.create({
    data: {
      tokenHash,
      scopeType,
      scopeId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  return { token: plainToken, id: record.id, expiresAt: record.expiresAt };
}

/**
 *
 * @param scopeType
 * @param scopeId
 */
export async function listRunners(scopeType: RunnerScope, scopeId: string) {
  return prisma.runner.findMany({
    where: { scopeType, scopeId },
    select: {
      id: true,
      uuid: true,
      name: true,
      status: true,
      labels: true,
      version: true,
      lastSeenAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 *
 * @param runnerId
 * @param scopeType
 * @param scopeId
 */
export async function getRunner(runnerId: string, scopeType: RunnerScope, scopeId: string) {
  const runner = await prisma.runner.findUnique({
    where: { id: runnerId },
    include: {
      tasks: {
        where: { status: { in: ['RUNNING', 'PENDING'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!runner || runner.scopeType !== scopeType || runner.scopeId !== scopeId) {
    throw new AppError(404, ERR.RUNNER_NOT_FOUND);
  }

  return runner;
}

/**
 *
 * @param runnerId
 * @param scopeType
 * @param scopeId
 */
export async function deleteRunner(runnerId: string, scopeType: RunnerScope, scopeId: string) {
  const runner = await prisma.runner.findUnique({ where: { id: runnerId } });
  if (!runner || runner.scopeType !== scopeType || runner.scopeId !== scopeId) {
    throw new AppError(404, ERR.RUNNER_NOT_FOUND);
  }

  await prisma.runner.delete({ where: { id: runnerId } });
}

/**
 *
 * @param projectId
 * @param taskId
 */
export async function getTask(taskId: string) {
  const task = await prisma.runnerTask.findUnique({
    where: { id: taskId },
    include: { runner: { select: { name: true, uuid: true } } },
  });
  if (!task) throw new AppError(404, ERR.TASK_NOT_FOUND);
  return task;
}

/**
 *
 * @param taskId
 * @param afterIndex
 */
export async function getTaskLogsSince(taskId: string, afterIndex: number) {
  return prisma.runnerTaskLog.findMany({
    where: { taskId, lineIndex: { gt: afterIndex } },
    orderBy: { lineIndex: 'asc' },
  });
}

/**
 *
 * @param taskId
 */
export async function getTaskStatus(taskId: string) {
  const task = await prisma.runnerTask.findUnique({
    where: { id: taskId },
    select: { status: true },
  });
  return task?.status ?? null;
}

/**
 *
 * @param projectId
 */
export async function resolveProjectScopes(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { team: { include: { org: true } } },
  });
  if (!project) throw new AppError(404, ERR.PROJECT_NOT_FOUND);

  return {
    projectId: project.id,
    teamId: project.teamId,
    orgId: project.team.orgId,
  };
}
