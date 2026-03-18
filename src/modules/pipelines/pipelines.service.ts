import { prisma } from '../../config/database';

import { parsePipelineYaml, validatePipeline } from './pipeline-parser';
import { runPipeline } from './pipeline-runner';

function makeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 *
 * @param repoId
 */
export async function listPipelines(repoId: string) {
  return prisma.pipeline.findMany({
    where: { repoId },
    include: {
      runs: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, status: true, createdAt: true },
      },
    },
  });
}

/**
 *
 * @param repoId
 * @param data
 * @param data.name
 * @param data.yamlContent
 */
export async function createPipeline(repoId: string, data: { name: string; yamlContent: string }) {
  const parsed = parsePipelineYaml(data.yamlContent);
  const errors = validatePipeline(parsed);
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400, errors });

  const slug = makeSlug(data.name);
  return prisma.pipeline.create({
    data: { repoId, name: data.name, slug, yamlContent: data.yamlContent },
  });
}

/**
 *
 * @param pipelineId
 * @param data
 * @param data.name
 * @param data.yamlContent
 * @param data.isActive
 */
export async function updatePipeline(
  pipelineId: string,
  data: { name?: string; yamlContent?: string; isActive?: boolean },
) {
  if (data.yamlContent) {
    const parsed = parsePipelineYaml(data.yamlContent);
    const errors = validatePipeline(parsed);
    if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400, errors });
  }
  return prisma.pipeline.update({ where: { id: pipelineId }, data });
}

/**
 *
 * @param pipelineId
 */
export async function deletePipeline(pipelineId: string) {
  await prisma.pipeline.delete({ where: { id: pipelineId } });
}

/**
 *
 * @param repoId
 * @param opts
 * @param opts.pipelineId
 * @param opts.status
 * @param opts.limit
 */
export async function listRuns(
  repoId: string,
  opts: { pipelineId?: string; status?: string; limit?: number },
) {
  return prisma.pipelineRun.findMany({
    where: {
      repoId,
      ...(opts.pipelineId ? { pipelineId: opts.pipelineId } : {}),
      ...(opts.status ? { status: opts.status as import('@prisma/client').RunStatus } : {}),
    },
    include: { pipeline: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 20,
  });
}

/**
 *
 * @param runId
 */
export async function getRun(runId: string) {
  return prisma.pipelineRun.findUnique({
    where: { id: runId },
    include: {
      pipeline: { select: { name: true } },
      jobs: { include: { steps: true }, orderBy: { id: 'asc' } },
    },
  });
}

/**
 *
 * @param pipelineId
 * @param repoId
 * @param userId
 * @param ref
 */
export async function triggerRun(pipelineId: string, repoId: string, userId: string, ref: string) {
  const pipeline = await prisma.pipeline.findUnique({ where: { id: pipelineId } });
  if (!pipeline) throw Object.assign(new Error('Pipeline not found'), { status: 404 });

  const run = await prisma.pipelineRun.create({
    data: {
      pipelineId,
      repoId,
      triggerType: 'MANUAL',
      triggerRef: ref,
      status: 'PENDING',
      triggeredById: userId,
    },
  });

  runPipeline(run).catch(console.error);
  return run;
}

/**
 *
 * @param runId
 */
export async function cancelRun(runId: string) {
  return prisma.pipelineRun.update({
    where: { id: runId },
    data: { status: 'CANCELLED', finishedAt: new Date() },
  });
}
