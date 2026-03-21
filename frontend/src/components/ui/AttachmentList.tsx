import { Download, Eye, Paperclip, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AttachmentPreview } from './AttachmentPreview';
import { Button } from './Button';

import { attachmentsApi } from '@/api/attachments.api';
import type { AttachmentMeta } from '@/api/attachments.api';
import { getAccessToken } from '@/api/client';
import { canPreview } from '@/lib/attachment-utils';
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

function AuthImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoke: string | null = null;
    const token = getAccessToken();
    fetch(src, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (blob) {
          revoke = URL.createObjectURL(blob);
          setBlobUrl(revoke);
        }
      })
      .catch(() => {});
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [src]);

  if (!blobUrl) {
    return (
      <div
        className={cn('flex items-center justify-center bg-surface-tertiary rounded', className)}
      >
        <Paperclip className="h-4 w-4 text-text-tertiary" />
      </div>
    );
  }

  return <img src={blobUrl} alt={alt} className={className} />;
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
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentMeta | null>(null);

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
          className={cn(
            'flex items-center gap-3 p-2 rounded-md border border-border bg-surface hover:bg-surface-secondary transition-colors',
            canPreview(att.mimeType) && 'cursor-pointer',
          )}
          onClick={() => canPreview(att.mimeType) && setPreviewAttachment(att)}
        >
          {isImage(att.mimeType) ? (
            <AuthImage
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
            {canPreview(att.mimeType) && (
              <Button
                variant="ghost"
                size="xs"
                onClick={(e) => {
                  e.stopPropagation();
                  setPreviewAttachment(att);
                }}
                title="Preview file"
              >
                <Eye className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                handleDownload(att);
              }}
              title="Download file"
            >
              <Download className="h-4 w-4" />
            </Button>

            {onDelete && currentUserId === att.uploaderId && (
              <Button
                variant="ghost"
                size="xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(att.id);
                }}
                title="Delete attachment"
              >
                <Trash2 className="h-4 w-4 text-danger" />
              </Button>
            )}
          </div>
        </div>
      ))}

      <AttachmentPreview
        attachment={previewAttachment}
        open={previewAttachment !== null}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}
