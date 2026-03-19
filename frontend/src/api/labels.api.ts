import { get, post, patch, del } from './client';

import type { Label } from '@/lib/types';

export interface LabelWithDescription extends Label {
  description?: string;
}

/** Labels API client for managing project issue labels. */
export const labelsApi = {
  /**
   * List all labels for a project.
   * @param projectId
   */
  list: async (projectId: string) => {
    const res = await get<{ data: LabelWithDescription[] }>(`/projects/${projectId}/labels`);
    return res.data;
  },
  /**
   * Create a new label with a name, color, and optional description.
   * @param projectId
   * @param data
   * @param data.name
   * @param data.color
   * @param data.description
   */
  create: (projectId: string, data: { name: string; color: string; description?: string }) =>
    post<LabelWithDescription>(`/projects/${projectId}/labels`, data),
  /**
   * Update a label's name, color, or description.
   * @param projectId
   * @param labelName
   * @param data
   * @param data.name
   * @param data.color
   * @param data.description
   */
  update: (
    projectId: string,
    labelName: string,
    data: { name?: string; color?: string; description?: string },
  ) =>
    patch<LabelWithDescription>(
      `/projects/${projectId}/labels/${encodeURIComponent(labelName)}`,
      data,
    ),
  /**
   * Delete a label by name.
   * @param projectId
   * @param labelName
   */
  delete: (projectId: string, labelName: string) =>
    del(`/projects/${projectId}/labels/${encodeURIComponent(labelName)}`),
};
