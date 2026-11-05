import { get, del, apiFormData } from './client';

export interface AttachmentMeta {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploaderId: string;
  issueId: string | null;
  pageId: string | null;
  commentId: string | null;
  createdAt: string;
}

export const attachmentsApi = {
  upload: async (
    file: File,
    opts: { issueId?: string; pageId?: string; commentId?: string } = {},
  ): Promise<AttachmentMeta> => {
    const formData = new FormData();
    formData.append('file', file);
    if (opts.issueId) formData.append('issueId', opts.issueId);
    if (opts.pageId) formData.append('pageId', opts.pageId);
    if (opts.commentId) formData.append('commentId', opts.commentId);

    return apiFormData<AttachmentMeta>('/attachments', formData);
  },

  list: (opts: { issueId?: string; pageId?: string } = {}): Promise<AttachmentMeta[]> => {
    const params = new URLSearchParams();
    if (opts.issueId) params.set('issueId', opts.issueId);
    if (opts.pageId) params.set('pageId', opts.pageId);
    return get<AttachmentMeta[]>(`/attachments?${params.toString()}`);
  },

  getDownloadUrl: (id: string): string => `/api/attachments/${id}`,

  getPreviewUrl: (id: string): string => `/api/attachments/${id}/preview`,

  convert: (id: string, format = 'markdown') =>
    get<{ markdown: string; originalName: string }>(`/attachments/${id}/convert?format=${format}`),

  remove: (id: string): Promise<void> => del<void>(`/attachments/${id}`),
};
