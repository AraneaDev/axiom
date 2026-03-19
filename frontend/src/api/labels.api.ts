import { get, post, patch, del } from './client';

import type { Label } from '@/lib/types';

export interface LabelWithDescription extends Label {
  description?: string;
}

export const labelsApi = {
  list: async (projectId: string) => {
    const res = await get<{ data: LabelWithDescription[] }>(`/projects/${projectId}/labels`);
    return res.data;
  },
  create: (projectId: string, data: { name: string; color: string; description?: string }) =>
    post<LabelWithDescription>(`/projects/${projectId}/labels`, data),
  update: (
    projectId: string,
    labelName: string,
    data: { name?: string; color?: string; description?: string },
  ) =>
    patch<LabelWithDescription>(
      `/projects/${projectId}/labels/${encodeURIComponent(labelName)}`,
      data,
    ),
  delete: (projectId: string, labelName: string) =>
    del(`/projects/${projectId}/labels/${encodeURIComponent(labelName)}`),
};
