/**
 * Pipeline execution engine.
 *
 * Orchestrates the execution of pipeline runs by parsing YAML configs,
 * executing jobs/steps in dependency order, streaming logs, and
 * reporting status back to the database and via WebSocket.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prisma } from '../config/database';
import { createOrUpdateStatus } from '../modules/status-checks/status-checks.service';
import { broadcastToRoom } from '../realtime/ws-server';
import { logger } from '../utils/logger';

import { createLogStreamer, removeLogStreamer } from './log-streamer';
import { parsePipelineConfig, type Step, type Job } from './yaml-parser';

const STEP_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per step

interface ExecutionContext {
  runId: string;
  repoId: string;
  commitSha: string | null;
  workDir: string;
  globalEnv: Record<string, string>;
  pipelineName: string;
}

/**
 * Main entry point: execute a pipeline run by its ID.
 * Loads the run from DB, parses the YAML, and executes all jobs.
 * @param runId
 */
export async function executePipelineRun(runId: string): Promise<void> {
  let workDir: string | null = null;
  const _logStreamer = createLogStreamer(runId, '');

  try {
    // Load the run with pipeline and repo
    const run = await prisma.pipelineRun.findUnique({
      where: { id: runId },
      include: {
        pipeline: true,
        repo: true,
      },
    });

    if (!run || !run.pipeline || !run.repo) {
      throw new Error(`Pipeline run ${runId} not found or missing pipeline/repo`);
    }

    // Update log streamer with correct repoId
    removeLogStreamer(runId);
    const streamer = createLogStreamer(runId, run.repoId);

    // Mark run as RUNNING
    await prisma.pipelineRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    notifyUpdate(run.repoId, runId);

    // Parse pipeline YAML using the new parser
    const config = parsePipelineConfig(run.pipeline.yamlContent);

    // Report PENDING commit status
    await reportStatus(run.repoId, run.commitSha, config.name, 'PENDING');

    // Clone the repo into a temp directory
    workDir = await mkdtemp(join(tmpdir(), 'axiom-ci-'));
    const ref = run.commitSha ?? run.triggerRef;

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        'git',
        ['clone', '--depth=1', '--branch', ref, run.repo.diskPath!, workDir!],
        {
          stdio: 'ignore',
        },
      );
      proc.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`git clone failed with code ${code}`)),
      );
    });

    const ctx: ExecutionContext = {
      runId,
      repoId: run.repoId,
      commitSha: run.commitSha ?? null,
      workDir,
      globalEnv: {
        AXIOM_COMMIT_SHA: run.commitSha ?? '',
        AXIOM_BRANCH: run.triggerRef,
        AXIOM_REPO_SLUG: run.repo.slug,
        AXIOM_TRIGGER: run.triggerType,
        AXIOM_RUN_ID: runId,
        AXIOM_PIPELINE: config.name,
      },
      pipelineName: config.name,
    };

    // Create job records upfront
    const jobRecords: Map<string, string> = new Map();
    for (const job of config.jobs) {
      const dbJob = await prisma.pipelineJob.create({
        data: { runId, name: job.name, status: 'PENDING' },
      });
      jobRecords.set(job.name, dbJob.id);
    }

    // Execute jobs in dependency order (wave-based)
    const waves = buildExecutionWaves(config.jobs);
    let runSuccess = true;

    for (const wave of waves) {
      const results = await Promise.all(
        wave.map((job) => {
          const dbJobId = jobRecords.get(job.name)!;
          return executeJob(job, dbJobId, ctx, streamer);
        }),
      );

      if (results.some((r) => !r)) {
        runSuccess = false;
        // Mark remaining pending jobs as SKIPPED
        for (const job of config.jobs) {
          const dbId = jobRecords.get(job.name)!;
          await prisma.pipelineJob.updateMany({
            where: { id: dbId, status: 'PENDING' },
            data: { status: 'SKIPPED' },
          });
        }
        break;
      }
    }

    // Finalize run
    const finalStatus = runSuccess ? 'SUCCESS' : 'FAILURE';
    await prisma.pipelineRun.update({
      where: { id: runId },
      data: { status: finalStatus, finishedAt: new Date() },
    });
    notifyUpdate(run.repoId, runId);

    // Report final commit status
    await reportStatus(
      run.repoId,
      run.commitSha,
      config.name,
      finalStatus as 'SUCCESS' | 'FAILURE',
    );

    // Update PR ciStatus if triggered by PR
    if (run.triggerType === 'PULL_REQUEST') {
      const prNumber = parseInt(run.triggerRef, 10);
      if (!isNaN(prNumber)) {
        await prisma.pullRequest.updateMany({
          where: { repoId: run.repoId, number: prNumber },
          data: { ciStatus: finalStatus },
        });
      }
    }

    streamer.stop();
  } catch (err) {
    logger.error('Pipeline run error', { runId }, err as Error);
    await prisma.pipelineRun
      .update({
        where: { id: runId },
        data: { status: 'FAILURE', finishedAt: new Date() },
      })
      .catch(() => {});
  } finally {
    removeLogStreamer(runId);
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Execute a single job (all steps sequentially).
 * @param job
 * @param dbJobId
 * @param ctx
 * @param logStreamer
 * @param logStreamer.append
 */
async function executeJob(
  job: Job,
  dbJobId: string,
  ctx: ExecutionContext,
  logStreamer: { append: (jobName: string, stepName: string, line: string) => void },
): Promise<boolean> {
  await prisma.pipelineJob.update({
    where: { id: dbJobId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });
  notifyUpdate(ctx.repoId, ctx.runId);

  let success = true;
  for (const step of job.steps) {
    const result = await executeStep(step, job, dbJobId, ctx, logStreamer);
    if (!result.success) {
      success = false;
      break;
    }
  }

  await prisma.pipelineJob.update({
    where: { id: dbJobId },
    data: { status: success ? 'SUCCESS' : 'FAILURE', finishedAt: new Date() },
  });
  notifyUpdate(ctx.repoId, ctx.runId);

  return success;
}

/**
 * Execute a single step within a job.
 * @param step
 * @param job
 * @param dbJobId
 * @param ctx
 * @param logStreamer
 * @param logStreamer.append
 */
async function executeStep(
  step: Step,
  job: Job,
  dbJobId: string,
  ctx: ExecutionContext,
  logStreamer: { append: (jobName: string, stepName: string, line: string) => void },
): Promise<{ success: boolean; exitCode: number }> {
  const dbStep = await prisma.pipelineStep.create({
    data: {
      jobId: dbJobId,
      name: step.name,
      command: step.run,
      status: 'RUNNING',
      startedAt: new Date(),
    },
  });

  return new Promise((resolve) => {
    const env = {
      ...process.env,
      ...ctx.globalEnv,
      ...(job.env ?? {}),
      ...(step.env ?? {}),
    };

    const proc = spawn('sh', ['-c', step.run], {
      cwd: ctx.workDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let outputBuffer = '';
    let killed = false;

    const flushOutput = async () => {
      if (outputBuffer.length === 0) return;
      const chunk = outputBuffer;
      outputBuffer = '';

      // Append to log streamer for real-time broadcasting
      logStreamer.append(job.name, step.name, chunk);

      // Persist to DB
      const current = await prisma.pipelineStep.findUnique({
        where: { id: dbStep.id },
        select: { output: true },
      });
      await prisma.pipelineStep
        .update({
          where: { id: dbStep.id },
          data: { output: { set: (current?.output ?? '') + chunk } },
        })
        .catch(() => {});
    };

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
      notifyUpdate(ctx.repoId, ctx.runId);

      resolve({ success: code === 0 && !killed, exitCode: code ?? -1 });
    });
  });
}

/**
 * Build execution waves from jobs respecting dependsOn ordering.
 * Jobs in the same wave can run in parallel.
 * @param jobs
 */
function buildExecutionWaves(jobs: Job[]): Job[][] {
  const inDegree: Map<string, number> = new Map();
  const dependents: Map<string, string[]> = new Map();
  const jobMap: Map<string, Job> = new Map();

  for (const job of jobs) {
    inDegree.set(job.name, 0);
    dependents.set(job.name, []);
    jobMap.set(job.name, job);
  }

  for (const job of jobs) {
    for (const dep of job.dependsOn ?? []) {
      inDegree.set(job.name, (inDegree.get(job.name) ?? 0) + 1);
      dependents.get(dep)?.push(job.name);
    }
  }

  const waves: Job[][] = [];
  let queue = [...inDegree.entries()].filter(([, deg]) => deg === 0).map(([name]) => name);

  while (queue.length > 0) {
    waves.push(queue.map((name) => jobMap.get(name)!));
    const next: string[] = [];
    for (const name of queue) {
      for (const dep of dependents.get(name) ?? []) {
        const newDeg = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, newDeg);
        if (newDeg === 0) next.push(dep);
      }
    }
    queue = next;
  }

  return waves;
}

/**
 * Broadcast a pipeline update via WebSocket.
 * @param repoId
 * @param runId
 */
function notifyUpdate(repoId: string, runId: string): void {
  try {
    broadcastToRoom(`repo:${repoId}`, {
      type: 'pipeline:updated',
      repoId,
      runId,
    });
  } catch {
    // Best effort
  }
}

/**
 * Report commit status check.
 * @param repoId
 * @param commitSha
 * @param pipelineName
 * @param state
 */
async function reportStatus(
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
