import type {
  WikiSpace,
  Page,
  PageTreeNode,
  PageVersion,
  PageTemplate,
  PageComment,
  PageLabel,
  PageRestriction,
  DiffResult,
} from '@/lib/types';

import { get, post, patch, put, del } from './client';

/** Wiki API client for spaces, pages, templates, comments, labels, and export. */
export const wikiApi = {
  /**
   * List all wiki spaces for a team.
   * @param teamId
   * @param includeArchived
   */
  listSpaces: (teamId: string, includeArchived?: boolean) =>
    get<WikiSpace[]>(
      `/wiki/team/${teamId}/spaces${includeArchived ? '?includeArchived=true' : ''}`,
    ),
  /**
   * Create a new wiki space within a team.
   * @param teamId
   * @param data
   * @param data.name
   * @param data.slug
   * @param data.description
   */
  createSpace: (teamId: string, data: { name: string; slug: string; description?: string }) =>
    post<WikiSpace>(`/wiki/team/${teamId}/spaces`, data),
  /**
   * Get a wiki space by ID.
   * @param spaceId
   */
  getSpace: (spaceId: string) => get<WikiSpace>(`/wiki/spaces/${spaceId}`),
  /**
   * Get the hierarchical page tree for a space.
   * @param spaceId
   */
  getPageTree: (spaceId: string) => get<PageTreeNode[]>(`/wiki/spaces/${spaceId}/tree`),
  /**
   * Get a single wiki page by its slug within a space.
   * @param spaceId
   * @param pageSlug
   */
  getPage: (spaceId: string, pageSlug: string) =>
    get<Page>(`/wiki/spaces/${spaceId}/pages/${pageSlug}`),
  /**
   * Create a new wiki page in a space.
   * @param spaceId
   * @param data
   * @param data.title
   * @param data.slug
   * @param data.body
   * @param data.parentId
   * @param data.isDraft
   */
  createPage: (
    spaceId: string,
    data: { title: string; slug: string; body?: string; parentId?: string; isDraft?: boolean },
  ) => post<Page>(`/wiki/spaces/${spaceId}/pages`, data),
  /**
   * Update an existing wiki page's title, body, or draft status.
   * @param spaceId
   * @param pageSlug
   * @param data
   * @param data.title
   * @param data.body
   * @param data.isDraft
   * @param data.parentId
   * @param data.changeDescription
   */
  updatePage: (
    spaceId: string,
    pageSlug: string,
    data: {
      title?: string;
      body?: string;
      isDraft?: boolean;
      parentId?: string | null;
      changeDescription?: string;
    },
  ) => patch<Page>(`/wiki/spaces/${spaceId}/pages/${pageSlug}`, data),
  /**
   * Save the live collaboration session of a page so the stored body matches the editor.
   * @param spaceId
   * @param pageSlug
   */
  flushCollab: (spaceId: string, pageSlug: string) =>
    post<{ flushed: boolean }>(`/wiki/spaces/${spaceId}/pages/${pageSlug}/collab/flush`, {}),
  /**
   * Delete a wiki page by slug.
   * @param spaceId
   * @param pageSlug
   */
  deletePage: (spaceId: string, pageSlug: string) =>
    del(`/wiki/spaces/${spaceId}/pages/${pageSlug}`),
  /**
   * Get the version history for a wiki page.
   * @param spaceId
   * @param pageSlug
   */
  getPageHistory: (spaceId: string, pageSlug: string) =>
    get<PageVersion[]>(`/wiki/spaces/${spaceId}/pages/${pageSlug}/history`),

  /**
   * List page templates for a space.
   * @param spaceId
   */
  listTemplates: (spaceId: string) => get<PageTemplate[]>(`/wiki/spaces/${spaceId}/templates`),
  /**
   * Create a new page template in a space.
   * @param spaceId
   * @param data
   * @param data.name
   * @param data.body
   * @param data.description
   */
  createTemplate: (spaceId: string, data: { name: string; body: string; description?: string }) =>
    post<PageTemplate>(`/wiki/spaces/${spaceId}/templates`, data),
  /**
   * Get a template by ID.
   * @param templateId
   */
  getTemplate: (templateId: string) => get<PageTemplate>(`/wiki/templates/${templateId}`),
  /**
   * Delete a template.
   * @param templateId
   */
  deleteTemplate: (templateId: string) => del(`/wiki/templates/${templateId}`),

  /**
   * List comments on a wiki page.
   * @param pageId
   */
  listPageComments: (pageId: string) => get<PageComment[]>(`/wiki/pages/${pageId}/comments`),
  /**
   * Add a comment to a wiki page, optionally anchored to highlighted text.
   * @param pageId
   * @param data
   * @param data.body
   * @param data.anchorText
   */
  addPageComment: (pageId: string, data: { body: string; anchorText?: string }) =>
    post<PageComment>(`/wiki/pages/${pageId}/comments`, data),
  /**
   * Resolve (mark as done) a page comment.
   * @param commentId
   */
  resolveComment: (commentId: string) => patch<PageComment>(`/wiki/comments/${commentId}`, {}),
  /**
   * Update the body of a page comment.
   * @param commentId
   * @param body
   */
  updatePageComment: (commentId: string, body: string) =>
    patch<PageComment>(`/wiki/comments/${commentId}`, { body }),
  /**
   * Delete a page comment.
   * @param commentId
   */
  deletePageComment: (commentId: string) => del(`/wiki/comments/${commentId}`),

  /**
   * Toggle a reaction on a comment (add if not present, remove if already given).
   * @param commentId
   * @param reactionType
   */
  toggleReaction: (commentId: string, reactionType: string) =>
    post<{ added: boolean }>(`/wiki/comments/${commentId}/reactions`, { reactionType }),

  /**
   * List labels attached to a wiki page.
   * @param pageId
   */
  listPageLabels: (pageId: string) => get<PageLabel[]>(`/wiki/pages/${pageId}/labels`),
  /**
   * Add a label to a wiki page.
   * @param pageId
   * @param label
   */
  addPageLabel: (pageId: string, label: string) =>
    post<PageLabel>(`/wiki/pages/${pageId}/labels`, { label }),
  /**
   * Remove a label from a wiki page.
   * @param pageId
   * @param label
   */
  removePageLabel: (pageId: string, label: string) =>
    del(`/wiki/pages/${pageId}/labels/${encodeURIComponent(label)}`),
  /**
   * Search pages in a space by label.
   * @param spaceId
   * @param label
   */
  searchByLabel: (spaceId: string, label: string) =>
    get<{ id: string; title: string; slug: string }[]>(
      `/wiki/spaces/${spaceId}/labels?label=${encodeURIComponent(label)}`,
    ),

  /**
   * Update a wiki space (e.g., archive/unarchive).
   * @param spaceId
   * @param data
   * @param data.isArchived
   */
  updateSpace: (spaceId: string, data: { isArchived?: boolean }) =>
    patch<WikiSpace>(`/wiki/spaces/${spaceId}`, data),

  /**
   * Get restrictions for a wiki page.
   * @param pageId
   */
  getRestrictions: (pageId: string) => get<PageRestriction[]>(`/wiki/pages/${pageId}/restrictions`),

  /**
   * Set restrictions on a wiki page (replaces existing of the given type).
   * @param pageId
   * @param type
   * @param userIds
   */
  setRestrictions: (pageId: string, type: 'VIEW' | 'EDIT', userIds: string[]) =>
    put<PageRestriction[]>(`/wiki/pages/${pageId}/restrictions`, { type, userIds }),

  /**
   * Remove a single page restriction.
   * @param restrictionId
   */
  removeRestriction: (restrictionId: string) => del(`/wiki/restrictions/${restrictionId}`),

  /**
   * Move a page to a different space or parent.
   * @param pageId
   * @param data
   * @param data.targetSpaceId
   * @param data.targetParentId
   */
  movePage: (pageId: string, data: { targetSpaceId?: string; targetParentId?: string | null }) =>
    post<Page>(`/wiki/pages/${pageId}/move`, data),
  /**
   * Copy a page, optionally to a different space with a new slug.
   * @param pageId
   * @param data
   * @param data.targetSpaceId
   * @param data.newSlug
   */
  copyPage: (pageId: string, data: { targetSpaceId?: string; newSlug?: string }) =>
    post<Page>(`/wiki/pages/${pageId}/copy`, data),
  /**
   * Reorder a page within the hierarchy.
   * @param pageId
   * @param data
   * @param data.parentId
   * @param data.position
   */
  reorderPage: (pageId: string, data: { parentId: string | null; position: number }) =>
    patch(`/wiki/pages/${pageId}/reorder`, data),

  /**
   * Compare two versions of a wiki page and return a structured diff.
   * @param spaceId
   * @param pageSlug
   * @param from - Version number to compare from
   * @param to - Version number to compare to
   */
  diffVersions: (spaceId: string, pageSlug: string, from: number, to: number) =>
    get<DiffResult>(`/wiki/spaces/${spaceId}/pages/${pageSlug}/diff?from=${from}&to=${to}`),

  /**
   * Restore a wiki page to a previous version.
   * @param spaceId
   * @param pageSlug
   * @param version - The version number to restore to
   */
  restoreVersion: (spaceId: string, pageSlug: string, version: number) =>
    post<Page>(`/wiki/spaces/${spaceId}/pages/${pageSlug}/restore`, { version }),

  // ─── Starred Pages ───────────────────────────────────────────

  /**
   * Toggle star on a wiki page (star if unstarred, unstar if starred).
   * @param pageId
   */
  toggleStar: (pageId: string) => post<{ starred: boolean }>(`/wiki/pages/${pageId}/star`, {}),

  /**
   * Check if a page is starred by the current user.
   * @param pageId
   */
  isStarred: (pageId: string) => get<{ starred: boolean }>(`/wiki/pages/${pageId}/star`),

  /**
   * Get all starred pages for the current user.
   */
  getStarredPages: () =>
    get<
      {
        id: string;
        starredAt: string;
        page: {
          id: string;
          title: string;
          slug: string;
          spaceId: string;
          space: {
            id: string;
            slug: string;
            name: string;
            team: { slug: string; org: { slug: string } };
          };
        };
      }[]
    >('/wiki/starred'),

  // ─── Page Analytics ────────────────────────────────────────────

  /**
   * Record a page view (debounced server-side, max 1 per user per page per hour).
   * @param pageId
   */
  recordView: (pageId: string) => post<void>(`/wiki/pages/${pageId}/view`, {}),

  /**
   * Get analytics for a wiki page (view count, unique viewers, recent viewers).
   * @param pageId
   */
  getAnalytics: (pageId: string) =>
    get<{
      viewCount: number;
      uniqueViewers: number;
      recentViewers: {
        user: { id: string; username: string; displayName: string; avatarUrl?: string };
        viewedAt: string;
      }[];
    }>(`/wiki/pages/${pageId}/analytics`),

  /**
   * Resolve template variables in a body string using the given context.
   * @param body - The template body containing variable placeholders
   * @param context - Resolution context (teamId, spaceId, optional projectId)
   * @param context.teamId
   * @param context.spaceId
   * @param context.projectId
   */
  resolveTemplate: (
    body: string,
    context: { teamId: string; spaceId: string; projectId?: string },
  ) => post<{ body: string }>('/wiki/resolve-template', { body, context }),

  /**
   * Export a wiki page as a downloadable file (HTML, DOCX, PDF, etc.). Uses raw fetch for blob download.
   * @param spaceId
   * @param pageSlug
   * @param format
   */
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
