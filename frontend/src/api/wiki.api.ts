import { get, post, patch, del } from './client';

import type {
  WikiSpace,
  Page,
  PageTreeNode,
  PageVersion,
  PageTemplate,
  PageComment,
  PageLabel,
} from '@/lib/types';

export const wikiApi = {
  listSpaces: (teamId: string) => get<WikiSpace[]>(`/wiki/team/${teamId}/spaces`),
  createSpace: (teamId: string, data: { name: string; slug: string; description?: string }) =>
    post<WikiSpace>(`/wiki/team/${teamId}/spaces`, data),
  getSpace: (spaceId: string) => get<WikiSpace>(`/wiki/spaces/${spaceId}`),
  getPageTree: (spaceId: string) => get<PageTreeNode[]>(`/wiki/spaces/${spaceId}/tree`),
  getPage: (spaceId: string, pageSlug: string) =>
    get<Page>(`/wiki/spaces/${spaceId}/pages/${pageSlug}`),
  createPage: (
    spaceId: string,
    data: { title: string; slug: string; body?: string; parentId?: string; isDraft?: boolean },
  ) => post<Page>(`/wiki/spaces/${spaceId}/pages`, data),
  updatePage: (
    spaceId: string,
    pageSlug: string,
    data: { title?: string; body?: string; isDraft?: boolean },
  ) => patch<Page>(`/wiki/spaces/${spaceId}/pages/${pageSlug}`, data),
  deletePage: (spaceId: string, pageSlug: string) =>
    del(`/wiki/spaces/${spaceId}/pages/${pageSlug}`),
  getPageHistory: (spaceId: string, pageSlug: string) =>
    get<PageVersion[]>(`/wiki/spaces/${spaceId}/pages/${pageSlug}/history`),

  // Templates
  listTemplates: (spaceId: string) => get<PageTemplate[]>(`/wiki/spaces/${spaceId}/templates`),
  createTemplate: (spaceId: string, data: { name: string; body: string; description?: string }) =>
    post<PageTemplate>(`/wiki/spaces/${spaceId}/templates`, data),
  getTemplate: (templateId: string) => get<PageTemplate>(`/wiki/templates/${templateId}`),
  deleteTemplate: (templateId: string) => del(`/wiki/templates/${templateId}`),

  // Page comments
  listPageComments: (pageId: string) => get<PageComment[]>(`/wiki/pages/${pageId}/comments`),
  addPageComment: (pageId: string, data: { body: string; anchorText?: string }) =>
    post<PageComment>(`/wiki/pages/${pageId}/comments`, data),
  resolveComment: (commentId: string) => patch<PageComment>(`/wiki/comments/${commentId}`, {}),
  deletePageComment: (commentId: string) => del(`/wiki/comments/${commentId}`),

  // Page labels
  listPageLabels: (pageId: string) => get<PageLabel[]>(`/wiki/pages/${pageId}/labels`),
  addPageLabel: (pageId: string, label: string) =>
    post<PageLabel>(`/wiki/pages/${pageId}/labels`, { label }),
  removePageLabel: (pageId: string, label: string) =>
    del(`/wiki/pages/${pageId}/labels/${encodeURIComponent(label)}`),
  searchByLabel: (spaceId: string, label: string) =>
    get<{ id: string; title: string; slug: string }[]>(
      `/wiki/spaces/${spaceId}/labels?label=${encodeURIComponent(label)}`,
    ),

  // Move / Copy
  movePage: (pageId: string, data: { targetSpaceId?: string; targetParentId?: string | null }) =>
    post<Page>(`/wiki/pages/${pageId}/move`, data),
  copyPage: (pageId: string, data: { targetSpaceId?: string; newSlug?: string }) =>
    post<Page>(`/wiki/pages/${pageId}/copy`, data),

  exportPage: async (spaceId: string, pageSlug: string, format: string) => {
    const token = localStorage.getItem('accessToken');
    const res = await fetch(
      `/api/wiki/spaces/${spaceId}/pages/${pageSlug}/export?format=${format}`,
      {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
          'X-Requested-With': 'XMLHttpRequest',
        },
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message ?? 'Export failed');
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const filenameMatch = disposition.match(/filename="(.+)"/);
    const filename = filenameMatch?.[1] ?? `export.${format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
