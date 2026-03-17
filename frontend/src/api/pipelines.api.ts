import { get, post, patch, del } from './client';

export interface Pipeline {
  id: string;
  repoId: string;
  name: string;
  slug: string;
  yamlContent: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  runs?: PipelineRunSummary[];
}

export interface PipelineRunSummary {
  id: string;
  status: RunStatus;
  createdAt: string;
}

export type RunStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILURE' | 'CANCELLED' | 'SKIPPED';

export interface PipelineRun {
  id: string;
  pipelineId: string;
  repoId: string;
  triggerType: string;
  triggerRef: string;
  commitSha?: string;
  status: RunStatus;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  pipeline?: { name: string };
  jobs?: PipelineJob[];
}

export interface PipelineJob {
  id: string;
  name: string;
  status: RunStatus;
  startedAt?: string;
  finishedAt?: string;
  steps: PipelineStep[];
}

export interface PipelineStep {
  id: string;
  name: string;
  command: string;
  status: RunStatus;
  output: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
}

export const pipelinesApi = {
  list: (repoId: string) => get<Pipeline[]>(`/repos/${repoId}/pipelines`),
  create: (repoId: string, data: { name: string; yamlContent: string }) =>
    post<Pipeline>(`/repos/${repoId}/pipelines`, data),
  update: (repoId: string, pipelineId: string, data: Partial<Pipeline>) =>
    patch<Pipeline>(`/repos/${repoId}/pipelines/${pipelineId}`, data),
  delete: (repoId: string, pipelineId: string) =>
    del(`/repos/${repoId}/pipelines/${pipelineId}`),
  listRuns: (repoId: string, params?: { pipelineId?: string; status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.pipelineId) q.set('pipelineId', params.pipelineId);
    if (params?.status) q.set('status', params.status);
    if (params?.limit) q.set('limit', String(params.limit));
    return get<PipelineRun[]>(`/repos/${repoId}/runs?${q}`);
  },
  getRun: (repoId: string, runId: string) => get<PipelineRun>(`/repos/${repoId}/runs/${runId}`),
  triggerRun: (repoId: string, pipelineId: string, ref: string) =>
    post<PipelineRun>(`/repos/${repoId}/pipelines/${pipelineId}/runs`, { ref }),
  cancelRun: (repoId: string, runId: string) =>
    post<PipelineRun>(`/repos/${repoId}/runs/${runId}/cancel`, {}),
};
