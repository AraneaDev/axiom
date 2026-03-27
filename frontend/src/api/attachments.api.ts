import { get, getAccessToken } from './client';

const API_BASE = '/api/attachments';

export interface AttachmentMeta {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  uploaderId: string;
  issueId: string | null;
  pageId: string | null;
  commentId: string | null;
  createdAt: string;
}

/** Attachments API client for uploading, listing, downloading, and removing file attachments. Uses raw fetch for multipart uploads. */
export const attachmentsApi = {
  /**
   * Upload a file attachment, optionally linked to an issue, page, or comment.
   * @param file
   * @param opts
   * @param opts.issueId
   * @param opts.pageId
   * @param opts.commentId
   */
  upload: async (
    file: File,
    opts: { issueId?: string; pageId?: string; commentId?: string } = {},
  ): Promise<AttachmentMeta> => {
    const formData = new FormData();
    formData.append('file', file);
    if (opts.issueId) formData.append('issueId', opts.issueId);
    if (opts.pageId) formData.append('pageId', opts.pageId);
    if (opts.commentId) formData.append('commentId', opts.commentId);

    const headers: Record<string, string> = {
      'X-Requested-With': 'XMLHttpRequest',
    };
    const token = getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(API_BASE, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message ?? 'Upload failed');
    }

    return res.json();
  },

  /**
   * List attachments filtered by issue or page.
   * @param opts
   * @param opts.issueId
   * @param opts.pageId
   */
  list: async (opts: { issueId?: string; pageId?: string } = {}): Promise<AttachmentMeta[]> => {
    const params = new URLSearchParams();
    if (opts.issueId) params.set('issueId', opts.issueId);
    if (opts.pageId) params.set('pageId', opts.pageId);

    const headers: Record<string, string> = {
      'X-Requested-With': 'XMLHttpRequest',
    };
    const token = getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}?${params.toString()}`, { headers });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message ?? 'Failed to list attachments');
    }

    return res.json();
  },

  /**
   * Get the download URL for an attachment.
   * @param id
   */
  getDownloadUrl: (id: string): string => {
    return `${API_BASE}/${id}`;
  },

  /**
   * Get the preview URL for an attachment (HTML preview via Pandoc).
   * @param id - Attachment ID.
   */
  getPreviewUrl: (id: string): string => {
    return `${API_BASE}/${id}/preview`;
  },

  /**
   * Convert an attachment to Markdown (or other format) via Pandoc.
   * @param id - Attachment ID.
   * @param format - Target format (default: markdown).
   */
  convert: (id: string, format = 'markdown') =>
    get<{ markdown: string; originalName: string }>(`/attachments/${id}/convert?format=${format}`),

  /**
   * Delete an attachment by ID.
   * @param id
   */
  remove: async (id: string): Promise<void> => {
    const headers: Record<string, string> = {
      'X-Requested-With': 'XMLHttpRequest',
    };
    const token = getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/${id}`, {
      method: 'DELETE',
      headers,
    });

    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message ?? 'Failed to delete attachment');
    }
  },
};
