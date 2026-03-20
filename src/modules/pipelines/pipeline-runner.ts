import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { broadcastToRoom } from '../../realtime/ws-server';
import { logger } from '../../utils/logger';
import { createOrUpdateStatus } from '../status-checks/status-checks.service';

import { parsePipelineYaml, getTopologicalOrder } from './pipeline-parser';
import type { ParsedStep } from './pipeline-parser';

const STEP_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Broadcast a pipeline update event to all WS clients watching the repo.
 * @param repoId
 * @param runId
 */
function notifyPipelineUpdate(repoId: string, runId: string): void {
  try {
    broadcastToRoom(`repo:${repoId}`, {
      type: 'pipeline:updated',
      repoId,
      runId,
    });
  } catch {
    // WS broadcast is best-effort
  }
}

/**
 * Report a commit status check for the pipeline run.
 * @param repoId
 * @param commitSha
 * @param pipelineName
 * @param state
 */
async function reportCommitStatus(
  repoId: string,
  commitSha: string | null | undefined,
  pipelineName: string,
  state: 'PENDING' | 'SUCCESS' | 'FAILURE',
): Promise<void> {
  if (!commitSha) return;
  try {
    await createOrUpdateStatus(repoId, commitSha, {
      context: `ci/${pipelineName}`,
      state,
      description:
        state === 'PENDING'
          ? 'Pipeline is running'
          : state === 'SUCCESS'
            ? 'Pipeline passed'
            : 'Pipeline failed',
    });
  } catch (err) {
    logger.error(
      'Failed to report commit status',
      { repoId, commitSha, pipelineName },
      err as Error,
    );
  }
}

interface RunContext {
  run: { id: string; commitSha?: string | null; triggerRef: string; repoId: string };
  tmpDir: string;
  env: Record<string, string>;
}

async function executeStep(
  step: ParsedStep,
  jobId: string,
  ctx: RunContext,
): Promise<{ success: boolean; exitCode: number }> {
  const dbStep = await prisma.pipelineStep.create({
    data: {
      jobId,
      name: step.name,
      command: step.run,
      status: 'RUNNING',
      startedAt: new Date(),
    },
  });

  return new Promise((resolve) => {
    const env = { ...process.env, ...ctx.env, ...(step.env ?? {}) };
    const proc = spawn('sh', ['-c', step.run], {
      cwd: ctx.tmpDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let outputBuffer = '';
    let killed = false;

    const flushOutput = async () => {
      if (outputBuffer.length === 0) return;
      const chunk = outputBuffer;
      outputBuffer = '';
      await prisma.pipelineStep
        .update({
          where: { id: dbStep.id },
          data: { output: { set: (await getStepOutput(dbStep.id)) + chunk } },
        })
        .catch(() => {});
    };

    async function getStepOutput(stepId: string): Promise<string> {
      const s = await prisma.pipelineStep.findUnique({
        where: { id: stepId },
        select: { output: true },
      });
      return s?.output ?? '';
    }

    const flushTimer = setInterval(flushOutput, 500);

    const timeout = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
    }, STEP_TIMEOUT_MS);

    proc.stdout.on('data', (d: Buffer) => {
      outputBuffer += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      outputBuffer += d.toString();
    });

    proc.on('close', async (code) => {
      clearTimeout(timeout);
      clearInterval(flushTimer);
      await flushOutput();
      const status = killed ? 'CANCELLED' : code === 0 ? 'SUCCESS' : 'FAILURE';
      await prisma.pipelineStep.update({
        where: { id: dbStep.id },
        data: { status, exitCode: code ?? -1, finishedAt: new Date() },
      });
      notifyPipelineUpdate(ctx.run.repoId, ctx.run.id);
      resolve({ success: code === 0 && !killed, exitCode: code ?? -1 });
    });
  });
}

async function executeJob(
  jobId: string,
  dbJobId: string,
  steps: ParsedStep[],
  ctx: RunContext,
): Promise<boolean> {
  await prisma.pipelineJob.update({
    where: { id: dbJobId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  let success = true;
  for (const step of steps) {
    const result = await executeStep(step, dbJobId, ctx);
    if (!result.success) {
      success = false;
      break;
    }
  }

  await prisma.pipelineJob.update({
    where: { id: dbJobId },
    data: { status: success ? 'SUCCESS' : 'FAILURE', finishedAt: new Date() },
  });
  notifyPipelineUpdate(ctx.run.repoId, ctx.run.id);

  return success;
}

/**
 *
 * @param runRecord
 * @param runRecord.id
 * @param runRecord.pipelineId
 * @param runRecord.commitSha
 * @param runRecord.triggerRef
 * @param runRecord.repoId
 */
export async function runPipeline(runRecord: {
  id: string;
  pipelineId: string;
  commitSha?: string | null;
  triggerRef: string;
  repoId: string;
}): Promise<void> {
  let tmpDir: string | null = null;

  try {
    await prisma.pipelineRun.update({
      where: { id: runRecord.id },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    notifyPipelineUpdate(runRecord.repoId, runRecord.id);

    // Get pipeline and repo
    const pipeline = await prisma.pipeline.findUnique({ where: { id: runRecord.pipelineId } });
    const repo = await prisma.repository.findUnique({ where: { id: runRecord.repoId } });
    if (!pipeline || !repo?.diskPath) throw new AppError(404, 'Pipeline or repo not found');

    const parsed = parsePipelineYaml(pipeline.yamlContent);

    // Report PENDING commit status
    await reportCommitStatus(runRecord.repoId, runRecord.commitSha, pipeline.name, 'PENDING');

    // Clone repo to temp dir
    tmpDir = await mkdtemp(join(tmpdir(), 'axiom-ci-'));
    await new Promise<void>((resolve, reject) => {
      const ref = runRecord.commitSha ?? runRecord.triggerRef;
      const proc = spawn('git', ['clone', '--depth=1', '--branch', ref, repo.diskPath!, tmpDir!], {
        stdio: 'inherit',
      });
      proc.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`git clone failed: ${code}`)),
      );
    });

    const env: Record<string, string> = {
      AXIOM_COMMIT_SHA: runRecord.commitSha ?? '',
      AXIOM_BRANCH: runRecord.triggerRef,
      AXIOM_REPO_SLUG: repo.slug,
      AXIOM_TRIGGER: 'push',
    };

    const ctx: RunContext = { run: runRecord, tmpDir, env };

    // Build execution waves
    const waves = getTopologicalOrder(parsed.jobs);

    // Create all job records upfront
    const jobDbIds: Record<string, string> = {};
    for (const jobId of Object.keys(parsed.jobs)) {
      const dbJob = await prisma.pipelineJob.create({
        data: { runId: runRecord.id, name: parsed.jobs[jobId].name ?? jobId, status: 'PENDING' },
      });
      jobDbIds[jobId] = dbJob.id;
    }

    let runSuccess = true;
    for (const wave of waves) {
      const waveResults = await Promise.all(
        wave.map((jobId) => executeJob(jobId, jobDbIds[jobId], parsed.jobs[jobId].steps, ctx)),
      );
      if (waveResults.some((r) => !r)) {
        runSuccess = false;
        // Mark remaining pending jobs as skipped
        for (const remaining of Object.keys(jobDbIds)) {
          await prisma.pipelineJob.updateMany({
            where: { id: jobDbIds[remaining], status: 'PENDING' },
            data: { status: 'SKIPPED' },
          });
        }
        break;
      }
    }

    const finalStatus = runSuccess ? 'SUCCESS' : 'FAILURE';
    await prisma.pipelineRun.update({
      where: { id: runRecord.id },
      data: { status: finalStatus, finishedAt: new Date() },
    });
    notifyPipelineUpdate(runRecord.repoId, runRecord.id);

    // Report commit status check
    await reportCommitStatus(
      runRecord.repoId,
      runRecord.commitSha,
      pipeline.name,
      finalStatus as 'SUCCESS' | 'FAILURE',
    );

    // Update PR ciStatus if triggered by PR
    const run = await prisma.pipelineRun.findUnique({ where: { id: runRecord.id } });
    if (run?.triggerType === 'PULL_REQUEST') {
      const prNumber = parseInt(run.triggerRef, 10);
      if (!isNaN(prNumber)) {
        await prisma.pullRequest.updateMany({
          where: { repoId: runRecord.repoId, number: prNumber },
          data: { ciStatus: finalStatus },
        });
      }
    }
  } catch (err) {
    logger.error('Pipeline runner error', { runId: runRecord.id }, err as Error);
    await prisma.pipelineRun
      .update({
        where: { id: runRecord.id },
        data: { status: 'FAILURE', finishedAt: new Date() },
      })
      .catch(() => {});
  } finally {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
