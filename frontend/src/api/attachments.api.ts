import { getAccessToken } from './client';

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

/**
 * Upload a file as an attachment.
 * Uses raw fetch with FormData (not the JSON api client).
 * @param file
 * @param opts
 * @param opts.issueId
 * @param opts.pageId
 * @param opts.commentId
 */
export async function upload(
  file: File,
  opts: { issueId?: string; pageId?: string; commentId?: string } = {},
): Promise<AttachmentMeta> {
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
    const body = await res.json().catch((err) => {
      console.error('Failed to parse error response JSON', err);
      return {};
    });
    throw new Error(body.error?.message ?? 'Upload failed');
  }

  return res.json();
}

/**
 * List attachments for a resource.
 * @param opts
 * @param opts.issueId
 * @param opts.pageId
 */
export async function list(
  opts: { issueId?: string; pageId?: string } = {},
): Promise<AttachmentMeta[]> {
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
    const body = await res.json().catch((err) => {
      console.error('Failed to parse error response JSON', err);
      return {};
    });
    throw new Error(body.error?.message ?? 'Failed to list attachments');
  }

  return res.json();
}

/**
 * Get the download URL for an attachment (with auth token as query param for direct access).
 * @param id
 */
export function getDownloadUrl(id: string): string {
  return `${API_BASE}/${id}`;
}

/**
 * Delete an attachment.
 * @param id
 */
export async function remove(id: string): Promise<void> {
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
    const body = await res.json().catch((err) => {
      console.error('Failed to parse error response JSON', err);
      return {};
    });
    throw new Error(body.error?.message ?? 'Failed to delete attachment');
  }
}
