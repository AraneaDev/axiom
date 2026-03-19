import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';

/**
 * Create a deployment environment for a repository.
 * @param repoId
 * @param data
 * @param data.name
 * @param data.url
 * @param data.protectionRules
 */
export async function createEnvironment(
  repoId: string,
  data: { name: string; url?: string; protectionRules?: Record<string, unknown> },
) {
  return prisma.deploymentEnvironment.create({
    data: {
      repoId,
      name: data.name,
      url: data.url,
      protectionRules: data.protectionRules
        ? (data.protectionRules as Prisma.InputJsonValue)
        : undefined,
    },
    include: {
      deployments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { deployedBy: { select: USER_BASIC_SELECT } },
      },
    },
  });
}

/**
 * List all environments for a repository, with latest deployment info.
 * @param repoId
 */
export async function listEnvironments(repoId: string) {
  return prisma.deploymentEnvironment.findMany({
    where: { repoId },
    include: {
      deployments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { deployedBy: { select: USER_BASIC_SELECT } },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Update an environment's settings.
 * @param envId
 * @param data
 * @param data.name
 * @param data.url
 * @param data.protectionRules
 */
export async function updateEnvironment(
  envId: string,
  data: { name?: string; url?: string; protectionRules?: Record<string, unknown> },
) {
  const updateData: Prisma.DeploymentEnvironmentUpdateInput = {
    ...(data.name !== undefined && { name: data.name }),
    ...(data.url !== undefined && { url: data.url }),
    ...(data.protectionRules !== undefined && {
      protectionRules: data.protectionRules as Prisma.InputJsonValue,
    }),
  };
  return prisma.deploymentEnvironment.update({
    where: { id: envId },
    data: updateData,
    include: {
      deployments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { deployedBy: { select: USER_BASIC_SELECT } },
      },
    },
  });
}

/**
 * Delete an environment and all its deployments.
 * @param envId
 */
export async function deleteEnvironment(envId: string) {
  await prisma.deploymentEnvironment.delete({ where: { id: envId } });
}

/**
 * Record a new deployment and update the environment's lastDeployedAt.
 * @param envId
 * @param data
 * @param data.commitSha
 * @param data.pipelineRunId
 * @param data.deployedById
 * @param data.status
 */
export async function createDeployment(
  envId: string,
  data: {
    commitSha: string;
    pipelineRunId?: string;
    deployedById: string;
    status?: 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILURE';
  },
) {
  const [deployment] = await prisma.$transaction([
    prisma.deployment.create({
      data: {
        environmentId: envId,
        commitSha: data.commitSha,
        pipelineRunId: data.pipelineRunId,
        deployedById: data.deployedById,
        status: data.status ?? 'PENDING',
      },
      include: {
        deployedBy: { select: USER_BASIC_SELECT },
        environment: { select: { id: true, name: true } },
        pipelineRun: { select: { id: true, status: true } },
      },
    }),
    prisma.deploymentEnvironment.update({
      where: { id: envId },
      data: { lastDeployedAt: new Date() },
    }),
  ]);
  return deployment;
}

/**
 * List deployments for an environment with pagination.
 * @param envId
 * @param opts
 * @param opts.limit
 * @param opts.offset
 */
export async function listDeployments(
  envId: string,
  opts: { limit?: number; offset?: number } = {},
) {
  return prisma.deployment.findMany({
    where: { environmentId: envId },
    include: {
      deployedBy: { select: USER_BASIC_SELECT },
      pipelineRun: { select: { id: true, status: true, pipeline: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 20,
    skip: opts.offset ?? 0,
  });
}

/**
 * Get a single deployment by ID.
 * @param deploymentId
 */
export async function getDeployment(deploymentId: string) {
  return prisma.deployment.findUnique({
    where: { id: deploymentId },
    include: {
      deployedBy: { select: USER_BASIC_SELECT },
      environment: true,
      pipelineRun: { select: { id: true, status: true, pipeline: { select: { name: true } } } },
    },
  });
}

/**
 * Find deployments by commit SHA across all environments of a repo.
 * @param repoId
 * @param commitSha
 */
export async function getDeploymentsByCommit(repoId: string, commitSha: string) {
  return prisma.deployment.findMany({
    where: {
      commitSha,
      environment: { repoId },
    },
    include: {
      environment: { select: { id: true, name: true, url: true } },
      deployedBy: { select: USER_BASIC_SELECT },
    },
    orderBy: { createdAt: 'desc' },
  });
}
