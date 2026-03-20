import crypto from 'crypto';

import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';

const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'default-env-key-must-be-32-chars!';

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function _decrypt(encrypted: string): string {
  const [ivHex, data] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Create a deployment environment for a repository.
 * @param repoId - The repository ID
 * @param data - Environment creation data including name, optional URL, and optional protection rules
 * @param data.name
 * @param data.url
 * @param data.protectionRules
 * @returns The created environment with latest deployment info
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
 * @param repoId - The repository ID
 * @returns List of environments with their most recent deployment
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
 * Update an environment's settings (name, URL, protection rules).
 * @param envId - The environment ID
 * @param data - Partial update data for name, URL, and/or protection rules
 * @param data.name
 * @param data.url
 * @param data.protectionRules
 * @returns The updated environment with latest deployment info
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
 * @param envId - The environment ID
 */
export async function deleteEnvironment(envId: string) {
  await prisma.deploymentEnvironment.delete({ where: { id: envId } });
}

/**
 * Record a new deployment and update the environment's lastDeployedAt timestamp.
 * @param envId - The environment ID
 * @param data - Deployment data including commitSha, optional pipelineRunId, deployedById, and optional status
 * @param data.commitSha
 * @param data.pipelineRunId
 * @param data.deployedById
 * @param data.status
 * @returns The created deployment with user, environment, and pipeline run details
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
 * @param envId - The environment ID
 * @param opts - Pagination options (limit, offset)
 * @param opts.limit
 * @param opts.offset
 * @returns List of deployments with user and pipeline run details
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
 * Get a single deployment by ID with full details.
 * @param deploymentId - The deployment ID
 * @returns The deployment with user, environment, and pipeline run details, or null
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
 * Find deployments by commit SHA across all environments of a repository.
 * @param repoId - The repository ID
 * @param commitSha - The commit SHA to search for
 * @returns List of deployments matching the commit SHA with environment and user details
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

// ─── Environment Variables ──────────────────────────────────

/**
 * List environment variables (values are masked).
 * @param envId - The environment ID
 * @returns List of variables with masked values
 */
export async function listEnvVariables(envId: string) {
  const variables = await prisma.environmentVariable.findMany({
    where: { environmentId: envId },
    orderBy: { name: 'asc' },
  });
  return variables.map((v) => ({
    id: v.id,
    name: v.name,
    value: '****',
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  }));
}

/**
 * Create or update an environment variable.
 * @param envId - The environment ID
 * @param name - Variable name
 * @param value - Variable value (will be encrypted)
 * @returns The created/updated variable with masked value
 */
export async function upsertEnvVariable(envId: string, name: string, value: string) {
  const encryptedValue = encrypt(value);
  const variable = await prisma.environmentVariable.upsert({
    where: { environmentId_name: { environmentId: envId, name } },
    create: { environmentId: envId, name, encryptedValue },
    update: { encryptedValue },
  });
  return {
    id: variable.id,
    name: variable.name,
    value: '****',
    createdAt: variable.createdAt,
    updatedAt: variable.updatedAt,
  };
}

/**
 * Delete an environment variable.
 * @param variableId - The variable ID
 */
export async function deleteEnvVariable(variableId: string) {
  await prisma.environmentVariable.delete({ where: { id: variableId } });
}
