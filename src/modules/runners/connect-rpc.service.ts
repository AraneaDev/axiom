import crypto from 'crypto';

import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { AppError } from '../../middleware/errorHandler';
import { broadcastToRoom } from '../../realtime/broadcast';
import { logger } from '../../utils/logger';
import { AUTOMATION_ISSUE_INCLUDE } from '../../utils/prisma-selects';
import { evaluateRules } from '../automation/automation.service';

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

/**
 * UpdateTask: runner reports job completion.
 * result: 0 = SUCCESS, non-zero = FAILURE
 * @param runnerId
 * @param data
 * @param data.id
 * @param data.result
 * @param data.stoppedAt
 */
export async function updateTask(
  runnerId: string,
  data: { id: string; result: number; stoppedAt?: string },
) {
  const task = await prisma.runnerTask.findUnique({ where: { id: data.id } });
  if (!task || task.runnerId !== runnerId) {
    throw new AppError(404, 'Task not found or not assigned to this runner');
  }

  const status = data.result === 0 ? 'SUCCESS' : 'FAILURE';

  const updated = await prisma.runnerTask.update({
    where: { id: data.id },
    data: {
      status,
      finishedAt: data.stoppedAt ? new Date(data.stoppedAt) : new Date(),
    },
  });

  // Set runner back to IDLE
  await prisma.runner.update({
    where: { id: runnerId },
    data: { status: 'IDLE' },
  });

  // Broadcast update
  broadcastToRoom(`repo:${updated.repoId}`, {
    type: 'runner-task:updated',
    repoId: updated.repoId,
    taskId: updated.id,
  });

  // Fire completion handlers (auto-comment + workflow triggers)
  await handleTaskCompletion(updated);

  return { state: { id: updated.id, result: data.result } };
}

/**
 * UpdateLog: runner streams log lines.
 * @param runnerId
 * @param data
 * @param data.taskId
 * @param data.index
 * @param data.rows
 * @param data.noMore
 */
export async function updateLog(
  runnerId: string,
  data: { taskId: string; index: number; rows: Array<{ content: string }>; noMore?: boolean },
) {
  const task = await prisma.runnerTask.findUnique({ where: { id: data.taskId } });
  if (!task || task.runnerId !== runnerId) {
    throw new AppError(404, 'Task not found or not assigned to this runner');
  }

  if (data.rows.length > 0) {
    await prisma.runnerTaskLog.createMany({
      data: data.rows.map((row, i) => ({
        taskId: data.taskId,
        lineIndex: data.index + i,
        content: row.content,
      })),
      skipDuplicates: true,
    });
  }

  const ackIndex = data.index + data.rows.length - 1;

  return { ackIndex: Math.max(ackIndex, 0) };
}

/**
 * Create a RunnerTask from a run_workflow automation action.
 * Resolves workflow content from repo file or pipeline definition.
 * @param params
 * @param params.source
 * @param params.workflowPath
 * @param params.pipelineId
 * @param params.repoId
 * @param params.ref
 * @param params.labels
 * @param params.variables
 * @param params.projectId
 * @param params.issueId
 * @param params.actorId
 * @param params.templateCtx
 */
export async function createRunnerTask(params: {
  source: 'repo_file' | 'pipeline';
  workflowPath?: string;
  pipelineId?: string;
  repoId?: string;
  ref?: string;
  labels: string[];
  variables?: Record<string, string>;
  projectId: string;
  issueId: string;
  actorId: string;
  templateCtx: Record<string, unknown>;
}) {
  let workflowContent: string;
  let workflowRef: string;
  let repoId: string;

  if (params.source === 'pipeline') {
    if (!params.pipelineId) throw new AppError(400, 'pipelineId required for pipeline source');
    const pipeline = await prisma.pipeline.findUnique({ where: { id: params.pipelineId } });
    if (!pipeline) throw new AppError(404, 'Pipeline not found');
    workflowContent = pipeline.yamlContent;
    workflowRef = params.pipelineId;
    repoId = params.repoId ?? pipeline.repoId;
  } else {
    // repo_file: read workflow YAML from git storage
    if (!params.workflowPath) throw new AppError(400, 'workflowPath required for repo_file source');

    // Find repo
    if (params.repoId) {
      repoId = params.repoId;
    } else {
      const repo = await prisma.repository.findFirst({
        where: { team: { projects: { some: { id: params.projectId } } } },
      });
      if (!repo) throw new AppError(404, 'No repository found for project');
      repoId = repo.id;
    }

    const repo = await prisma.repository.findUnique({ where: { id: repoId } });
    if (!repo) throw new AppError(404, 'Repository not found');
    if (!repo.diskPath) throw new AppError(500, 'Repository has no disk path');

    // Read file from git -- use execFileSync to prevent command injection
    const ref = params.ref ?? 'HEAD';
    const { execFileSync } = await import('child_process');
    try {
      workflowContent = execFileSync('git', ['show', `${ref}:${params.workflowPath}`], {
        cwd: repo.diskPath,
        encoding: 'utf-8',
        timeout: 5000,
      });
    } catch {
      throw new AppError(404, `Workflow file not found: ${params.workflowPath} at ${ref}`);
    }
    workflowRef = params.workflowPath;
  }

  // Resolve template variables
  const resolvedVars: Record<string, string> = {};
  if (params.variables) {
    const { resolveTemplate } = await import('../../lib/query-engine');
    for (const [key, val] of Object.entries(params.variables)) {
      resolvedVars[key] = resolveTemplate(val, params.templateCtx);
    }
  }

  const task = await prisma.runnerTask.create({
    data: {
      workflowSource: params.source,
      workflowRef,
      workflowContent,
      repoId,
      gitRef: params.ref ?? 'HEAD',
      status: 'PENDING',
      context: { ...resolvedVars, issueId: params.issueId, actorId: params.actorId },
      labels: params.labels,
      issueId: params.issueId,
    },
  });

  await incrementTasksVersion();

  logger.info('Runner task created', { taskId: task.id, source: params.source, workflowRef });

  return task;
}

/**
 * Handle task completion: post comment on issue, fire workflow triggers.
 * @param task
 * @param task.id
 * @param task.issueId
 * @param task.status
 * @param task.workflowRef
 * @param task.workflowSource
 * @param task.startedAt
 * @param task.finishedAt
 * @param task.repoId
 * @param task.context
 */
async function handleTaskCompletion(task: {
  id: string;
  issueId: string | null;
  status: string;
  workflowRef: string;
  workflowSource: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  repoId: string;
  context: unknown;
}) {
  if (!task.issueId) return;

  const issue = await prisma.issue.findUnique({
    where: { id: task.issueId },
    include: AUTOMATION_ISSUE_INCLUDE,
  });
  if (!issue) return;

  // Calculate duration
  const durationMs =
    task.startedAt && task.finishedAt ? task.finishedAt.getTime() - task.startedAt.getTime() : 0;
  const durationSec = Math.round(durationMs / 1000);

  // Post comment on issue
  const statusText = task.status === 'SUCCESS' ? 'SUCCESS' : 'FAILURE';
  const workflowName =
    task.workflowSource === 'pipeline'
      ? task.workflowRef
      : (task.workflowRef.split('/').pop() ?? task.workflowRef);

  const actorId = (task.context as Record<string, string>)?.actorId ?? issue.creatorId;

  await prisma.comment.create({
    data: {
      issueId: task.issueId,
      authorId: actorId,
      body: `Workflow \`${workflowName}\` completed with status **${statusText}** (${durationSec}s)`,
    },
  });

  // Fire workflow trigger for downstream automation
  const trigger = task.status === 'SUCCESS' ? 'workflow:completed' : 'workflow:failed';

  evaluateRules(issue.projectId, trigger, {
    issue: issue as unknown as Record<string, unknown> & { id: string; projectId: string },
    actorId,
    automationDepth: 1,
  }).catch((err) => logger.error('Workflow trigger evaluation failed', {}, err as Error));
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
