import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { parseServicePagination } from '../../utils/pagination';

import { parsePipelineYaml, validatePipeline } from './pipeline-parser';
import { runPipeline } from './pipeline-runner';

function makeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * List all pipelines for a repository with their latest run status.
 * @param repoId - The repository ID
 * @returns List of pipelines with the most recent run info
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
 * Create a new CI/CD pipeline, parsing and validating the YAML configuration.
 * @param repoId - The repository ID
 * @param data - Pipeline creation data including name and YAML content
 * @param data.name
 * @param data.yamlContent
 * @returns The created pipeline record
 * @throws {Error} 400 if YAML validation fails
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
 * Update a pipeline's name, YAML content, or active status.
 * @param pipelineId - The pipeline ID
 * @param data - Partial update data for name, yamlContent, and/or isActive
 * @param data.name
 * @param data.yamlContent
 * @param data.isActive
 * @returns The updated pipeline record
 * @throws {Error} 400 if updated YAML validation fails
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
 * Delete a pipeline and all its associated runs.
 * @param pipelineId - The pipeline ID
 */
export async function deletePipeline(pipelineId: string) {
  await prisma.pipeline.delete({ where: { id: pipelineId } });
}

/**
 * List pipeline runs for a repository with optional pipeline and status filters.
 * @param repoId - The repository ID
 * @param opts - Filter options including pipelineId, status, and limit
 * @param opts.pipelineId
 * @param opts.status
 * @param opts.limit
 * @returns List of pipeline runs with pipeline name
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
    take: parseServicePagination(opts, 20).take,
  });
}

/**
 * Get a pipeline run by ID with jobs and steps.
 * @param runId - The pipeline run ID
 * @returns The pipeline run with pipeline name, jobs, and steps
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
 * Manually trigger a pipeline run on a given git ref.
 * @param pipelineId - The pipeline ID
 * @param repoId - The repository ID
 * @param userId - The user triggering the run
 * @param ref - The git ref (branch or tag) to run against
 * @returns The created pipeline run record
 * @throws {Error} 404 if pipeline not found
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

  runPipeline(run).catch((err) =>
    logger.error('Pipeline execution failed', { runId: run.id, pipelineId }, err),
  );
  return run;
}

/**
 * Cancel a pipeline run by setting its status to CANCELLED.
 * @param runId - The pipeline run ID
 * @returns The updated pipeline run record
 */
export async function cancelRun(runId: string) {
  return prisma.pipelineRun.update({
    where: { id: runId },
    data: { status: 'CANCELLED', finishedAt: new Date() },
  });
}
