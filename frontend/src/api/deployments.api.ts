import { get, post, patch, del } from './client';

export interface EnvironmentVariable {
  id: string;
  name: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentEnvironment {
  id: string;
  repoId: string;
  name: string;
  url?: string | null;
  lastDeployedAt?: string | null;
  protectionRules?: Record<string, unknown> | null;
  createdAt: string;
  deployments: Deployment[];
}

export interface Deployment {
  id: string;
  environmentId: string;
  commitSha: string;
  pipelineRunId?: string | null;
  status: DeploymentStatus;
  deployedById: string;
  deployedBy: { id: string; username: string; displayName: string | null };
  environment?: { id: string; name: string; url?: string | null };
  pipelineRun?: { id: string; status: string; pipeline?: { name: string } } | null;
  createdAt: string;
}

export type DeploymentStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILURE';

export const deploymentsApi = {
  // Environments
  listEnvironments: (repoId: string) =>
    get<DeploymentEnvironment[]>(`/repos/${repoId}/environments`),

  createEnvironment: (
    repoId: string,
    data: { name: string; url?: string; protectionRules?: Record<string, unknown> },
  ) => post<DeploymentEnvironment>(`/repos/${repoId}/environments`, data),

  updateEnvironment: (
    repoId: string,
    envId: string,
    data: { name?: string; url?: string; protectionRules?: Record<string, unknown> },
  ) => patch<DeploymentEnvironment>(`/repos/${repoId}/environments/${envId}`, data),

  deleteEnvironment: (repoId: string, envId: string) =>
    del(`/repos/${repoId}/environments/${envId}`),

  // Deployments
  createDeployment: (
    repoId: string,
    envId: string,
    data: { commitSha: string; pipelineRunId?: string; status?: DeploymentStatus },
  ) => post<Deployment>(`/repos/${repoId}/environments/${envId}/deployments`, data),

  listDeployments: (repoId: string, envId: string, opts?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const q = params.toString();
    return get<Deployment[]>(
      `/repos/${repoId}/environments/${envId}/deployments${q ? `?${q}` : ''}`,
    );
  },

  getDeployment: (repoId: string, envId: string, deploymentId: string) =>
    get<Deployment>(`/repos/${repoId}/environments/${envId}/deployments/${deploymentId}`),

  // Deployments by commit
  getDeploymentsByCommit: (repoId: string, commitSha: string) =>
    get<Deployment[]>(`/repos/${repoId}/commits/${commitSha}/deployments`),

  // Environment Variables
  listEnvVariables: (repoId: string, envId: string) =>
    get<EnvironmentVariable[]>(`/repos/${repoId}/environments/${envId}/variables`),

  createEnvVariable: (repoId: string, envId: string, data: { name: string; value: string }) =>
    post<EnvironmentVariable>(`/repos/${repoId}/environments/${envId}/variables`, data),

  updateEnvVariable: (
    repoId: string,
    envId: string,
    variableId: string,
    data: { name: string; value: string },
  ) =>
    patch<EnvironmentVariable>(
      `/repos/${repoId}/environments/${envId}/variables/${variableId}`,
      data,
    ),

  deleteEnvVariable: (repoId: string, envId: string, variableId: string) =>
    del(`/repos/${repoId}/environments/${envId}/variables/${variableId}`),
};
