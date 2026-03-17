import { get, post, patch, del } from './client';
import type { WikiSpace, Page, PageTreeNode, PageVersion } from '@/lib/types';

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
};
