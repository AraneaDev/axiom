import crypto from 'crypto';

import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';

const TASKS_VERSION_KEY = 'runner:tasks_version';

/**
 *
 * @param data
 * @param data.name
 * @param data.token
 * @param data.labels
 * @param data.version
 */
export async function registerRunner(data: {
  name: string;
  token: string;
  labels: string[];
  version: string;
}) {
  const regTokens = await prisma.runnerRegistrationToken.findMany({
    where: {
      usedBy: null,
      expiresAt: { gt: new Date() },
    },
    take: 100,
    orderBy: { createdAt: 'desc' },
  });

  let matchedToken: (typeof regTokens)[0] | null = null;
  for (const rt of regTokens) {
    if (await bcrypt.compare(data.token, rt.tokenHash)) {
      matchedToken = rt;
      break;
    }
  }

  if (!matchedToken) {
    throw new AppError(400, 'Invalid or expired registration token');
  }

  const uuid = crypto.randomUUID();
  const plainToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = await bcrypt.hash(plainToken, 10);

  const runner = await prisma.runner.create({
    data: {
      uuid,
      name: data.name,
      tokenHash,
      status: 'IDLE',
      labels: data.labels,
      version: data.version,
      scopeType: matchedToken.scopeType,
      scopeId: matchedToken.scopeId,
      lastSeenAt: new Date(),
    },
  });

  await prisma.runnerRegistrationToken.update({
    where: { id: matchedToken.id },
    data: { usedBy: runner.id },
  });

  logger.info('Runner registered', { uuid, name: data.name, scopeType: matchedToken.scopeType });

  return {
    runner: {
      uuid: runner.uuid,
      token: plainToken,
      name: runner.name,
    },
  };
}

/**
 *
 * @param runnerId
 * @param data
 * @param data.version
 * @param data.labels
 */
export async function declareRunner(runnerId: string, data: { version: string; labels: string[] }) {
  const runner = await prisma.runner.update({
    where: { id: runnerId },
    data: {
      version: data.version,
      labels: data.labels,
      status: 'IDLE',
      lastSeenAt: new Date(),
    },
  });

  return {
    runner: {
      uuid: runner.uuid,
      name: runner.name,
      status: runner.status,
    },
  };
}

/**
 * Increment the global tasks version counter.
 * Called when a new RunnerTask is created.
 */
export async function incrementTasksVersion() {
  try {
    await redis.incr(TASKS_VERSION_KEY);
  } catch {
    // Redis unavailable -- runners will always query DB (fallback)
  }
}

/**
 * FetchTask: find and atomically claim a pending task for this runner.
 * Uses raw SQL UPDATE ... WHERE status = 'PENDING' RETURNING * for atomicity.
 * @param runner
 * @param runner.id
 * @param runner.scopeType
 * @param runner.scopeId
 * @param runner.labels
 * @param tasksVersion
 */
export async function fetchTask(
  runner: {
    id: string;
    scopeType: string;
    scopeId: string;
    labels: unknown;
  },
  tasksVersion?: number,
) {
  // Version optimization: skip DB query if no new tasks
  if (tasksVersion !== undefined) {
    try {
      const currentVersion = await redis.get(TASKS_VERSION_KEY);
      if (currentVersion && parseInt(currentVersion, 10) === tasksVersion) {
        return { task: null, tasksVersion };
      }
    } catch {
      // Redis unavailable -- fall through to DB query
    }
  }

  // Build scope filter
  const scopeIds = await getEligibleScopeIds(runner.scopeType, runner.scopeId);

  if (scopeIds.length === 0) {
    return { task: null, tasksVersion: await getCurrentTasksVersion() };
  }

  // Atomic claim using raw SQL with FOR UPDATE SKIP LOCKED
  const claimed = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      UPDATE runner_tasks
      SET status = 'RUNNING', "runnerId" = ${runner.id}, "startedAt" = NOW(), "updatedAt" = NOW()
      WHERE id = (
        SELECT rt.id FROM runner_tasks rt
        JOIN repositories r ON rt."repoId" = r.id
        JOIN projects p ON r."teamId" = p."teamId"
        WHERE rt.status = 'PENDING'
        AND p.id IN (${Prisma.join(scopeIds)})
        ORDER BY rt."createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `,
  );

  if (claimed.length === 0) {
    return { task: null, tasksVersion: await getCurrentTasksVersion() };
  }

  const task = await prisma.runnerTask.findUnique({
    where: { id: claimed[0].id },
  });

  // Set runner to ACTIVE
  await prisma.runner.update({
    where: { id: runner.id },
    data: { status: 'ACTIVE' },
  });

  return {
    task: task
      ? {
          id: task.id,
          workflowPayload: task.workflowContent,
          context: task.context,
          gitRef: task.gitRef,
        }
      : null,
    tasksVersion: await getCurrentTasksVersion(),
  };
}

async function getCurrentTasksVersion(): Promise<number | undefined> {
  try {
    const v = await redis.get(TASKS_VERSION_KEY);
    return v ? parseInt(v, 10) : 0;
  } catch {
    return undefined;
  }
}

async function getEligibleScopeIds(scopeType: string, scopeId: string): Promise<string[]> {
  switch (scopeType) {
    case 'PROJECT':
      return [scopeId];
    case 'TEAM': {
      const projects = await prisma.project.findMany({
        where: { teamId: scopeId },
        select: { id: true },
      });
      return projects.map((p) => p.id);
    }
    case 'ORG': {
      const projects = await prisma.project.findMany({
        where: { team: { orgId: scopeId } },
        select: { id: true },
      });
      return projects.map((p) => p.id);
    }
    default:
      return [];
  }
}
