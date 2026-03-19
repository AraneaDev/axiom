import { Paperclip, Download, Trash2 } from 'lucide-react';

import { Button } from './Button';

import { attachmentsApi } from '@/api/attachments.api';
import type { AttachmentMeta } from '@/api/attachments.api';
import { getAccessToken } from '@/api/client';
import { cn } from '@/lib/utils';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

interface AttachmentListProps {
  attachments: AttachmentMeta[];
  currentUserId?: string;
  onDelete?: (id: string) => void;
  className?: string;
}

/**
 *
 * @param root0
 * @param root0.attachments
 * @param root0.currentUserId
 * @param root0.onDelete
 * @param root0.className
 */
export function AttachmentList({
  attachments,
  currentUserId,
  onDelete,
  className,
}: AttachmentListProps) {
  if (attachments.length === 0) return null;

  const handleDownload = async (attachment: AttachmentMeta) => {
    const url = attachmentsApi.getDownloadUrl(attachment.id);
    const token = getAccessToken();
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = attachment.originalName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  };

  return (
    <div className={cn('space-y-2', className)}>
      {attachments.map((att) => (
        <div
          key={att.id}
          className="flex items-center gap-3 p-2 rounded-md border border-border bg-surface hover:bg-surface-secondary transition-colors"
        >
          {isImage(att.mimeType) ? (
            <img
              src={attachmentsApi.getDownloadUrl(att.id)}
              alt={att.originalName}
              className="h-10 w-10 rounded object-cover border border-border-light"
            />
          ) : (
            <div className="flex items-center justify-center h-10 w-10 rounded bg-surface-tertiary">
              <Paperclip className="h-4 w-4 text-text-secondary" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text truncate">{att.originalName}</div>
            <div className="text-xs text-text-tertiary">
              {formatSize(att.size)} -- {formatDate(att.createdAt)}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => handleDownload(att)}
              title="Download file"
            >
              <Download className="h-4 w-4" />
            </Button>

            {onDelete && currentUserId === att.uploaderId && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onDelete(att.id)}
                title="Delete attachment"
              >
                <Trash2 className="h-4 w-4 text-danger" />
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
