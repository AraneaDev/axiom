/**
 * Pipeline trigger service.
 *
 * Checks whether any pipelines match a push event and triggers runs.
 */

import { prisma } from '../config/database';
import { runPipeline } from '../modules/pipelines/pipeline-runner';
import { logger } from '../utils/logger';

import { parsePipelineConfig, matchesTrigger } from './yaml-parser';

/**
 * Check if any pipelines for the given repo match the push event,
 * and trigger runs for matching pipelines.
 * @param repoId - Repository ID
 * @param branch - Branch name (e.g. "main", "feature/foo")
 * @param commitSha - The commit SHA being pushed
 */
export async function triggerPipelineOnPush(
  repoId: string,
  branch: string,
  commitSha: string,
): Promise<void> {
  try {
    // Find all active pipelines for this repo
    const pipelines = await prisma.pipeline.findMany({
      where: { repoId, isActive: true },
    });

    if (pipelines.length === 0) return;

    for (const pipeline of pipelines) {
      try {
        const config = parsePipelineConfig(pipeline.yamlContent);

        // Check if this push matches the pipeline's trigger config
        if (!matchesTrigger(config.trigger, branch, 'push')) {
          continue;
        }

        // Create a new pipeline run
        const run = await prisma.pipelineRun.create({
          data: {
            pipelineId: pipeline.id,
            repoId,
            triggerType: 'PUSH',
            triggerRef: branch,
            commitSha,
            status: 'PENDING',
          },
        });

        logger.info('Pipeline triggered', {
          pipeline: pipeline.name,
          branch,
          commit: commitSha.slice(0, 7),
        });

        // Execute the pipeline run asynchronously
        runPipeline(run).catch((err) => {
          logger.error('Pipeline run failed', { runId: run.id }, err as Error);
        });
      } catch (err) {
        logger.error(
          'Failed to evaluate pipeline for trigger',
          { pipeline: pipeline.name },
          err as Error,
        );
      }
    }
  } catch (err) {
    logger.error('Error checking pipeline triggers', { repoId, branch }, err as Error);
  }
}
