import { useQuery } from '@tanstack/react-query';
import { Copy, Download, FileText, FileWarning, Loader2, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from './Button';
import { Modal, ModalFooter } from './Modal';

import { attachmentsApi } from '@/api/attachments.api';
import type { AttachmentMeta } from '@/api/attachments.api';
import { getAccessToken } from '@/api/client';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { canConvertToMarkdown, getPreviewType } from '@/lib/attachment-utils';

interface AttachmentPreviewProps {
  attachment: AttachmentMeta | null;
  open: boolean;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fetchAuthBlob(url: string): Promise<string> {
  const token = getAccessToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Failed to fetch');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

async function fetchAuthText(url: string): Promise<string> {
  const token = getAccessToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Failed to fetch');
  return res.text();
}

function useAuthBlob(url: string) {
  const prevBlobRef = useRef<string | null>(null);

  const { data: blobUrl, isLoading: loading } = useQuery({
    queryKey: ['auth-blob', url],
    queryFn: async () => {
      if (prevBlobRef.current) {
        URL.revokeObjectURL(prevBlobRef.current);
        prevBlobRef.current = null;
      }
      const result = await fetchAuthBlob(url);
      prevBlobRef.current = result;
      return result;
    },
    staleTime: Infinity,
  });

  useEffect(() => {
    return () => {
      if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current);
    };
  }, []);

  return { blobUrl: blobUrl ?? null, loading };
}

function useAuthText(url: string) {
  const { data: text, isLoading: loading } = useQuery({
    queryKey: ['auth-text', url],
    queryFn: () => fetchAuthText(url),
    staleTime: Infinity,
  });

  return { text: text ?? null, loading };
}

function ImagePreview({ attachment }: { attachment: AttachmentMeta }) {
  const url = attachmentsApi.getDownloadUrl(attachment.id);
  const { blobUrl, loading } = useAuthBlob(url);

  if (loading || !blobUrl) {
    return (
      <div className="flex items-center justify-center h-64 bg-surface-tertiary rounded-lg">
        <Loader2 className="h-6 w-6 text-text-tertiary animate-spin" />
      </div>
    );
  }

  return (
    <img
      src={blobUrl}
      alt={attachment.originalName}
      className="max-h-[70vh] object-contain mx-auto rounded-lg"
    />
  );
}

function PdfPreview({ attachment }: { attachment: AttachmentMeta }) {
  const url = attachmentsApi.getDownloadUrl(attachment.id);
  const { blobUrl, loading } = useAuthBlob(url);

  if (loading || !blobUrl) {
    return (
      <div className="flex items-center justify-center h-64 bg-surface-tertiary rounded-lg">
        <Loader2 className="h-6 w-6 text-text-tertiary animate-spin" />
      </div>
    );
  }

  return <iframe src={blobUrl} className="w-full h-[70vh] rounded-lg border border-border" />;
}

function TextPreview({ attachment }: { attachment: AttachmentMeta }) {
  const url = attachmentsApi.getDownloadUrl(attachment.id);
  const { text, loading } = useAuthText(url);

  if (loading || text === null) {
    return (
      <div className="flex items-center justify-center h-64 bg-surface-tertiary rounded-lg">
        <Loader2 className="h-6 w-6 text-text-tertiary animate-spin" />
      </div>
    );
  }

  return (
    <pre className="text-sm font-mono bg-surface-tertiary rounded-lg p-4 overflow-auto max-h-[70vh]">
      {text}
    </pre>
  );
}

function DocumentPreview({ attachment }: { attachment: AttachmentMeta }) {
  const url = attachmentsApi.getPreviewUrl(attachment.id);
  const { text: html, loading } = useAuthText(url);

  if (loading || html === null) {
    return (
      <div className="flex items-center justify-center h-64 bg-surface-tertiary rounded-lg">
        <Loader2 className="h-6 w-6 text-text-tertiary animate-spin" />
      </div>
    );
  }

  return (
    <div
      className="prose prose-sm max-w-none bg-surface-tertiary rounded-lg p-4 overflow-auto max-h-[70vh]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function UnsupportedPreview({ attachment }: { attachment: AttachmentMeta }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12">
      <FileWarning className="h-12 w-12 text-text-tertiary" />
      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-text">{attachment.originalName}</p>
        <p className="text-xs text-text-tertiary">
          {formatSize(attachment.size)} -- {attachment.mimeType}
        </p>
        <p className="text-xs text-text-secondary">Preview is not available for this file type.</p>
      </div>
    </div>
  );
}

function MarkdownConvertView({
  attachment,
  onBack,
}: {
  attachment: AttachmentMeta;
  onBack: () => void;
}) {
  const {
    data: result,
    isLoading: loading,
    isError,
  } = useQuery({
    queryKey: ['attachment-convert', attachment.id],
    queryFn: () => attachmentsApi.convert(attachment.id),
    staleTime: Infinity,
  });

  const markdown = result?.markdown ?? null;
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [markdown]);

  const handleDownloadMd = useCallback(() => {
    if (!markdown) return;
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = attachment.originalName.replace(/\.[^.]+$/, '');
    a.download = `${baseName}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [markdown, attachment.originalName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 text-text-tertiary animate-spin" />
      </div>
    );
  }

  if (isError || markdown === null) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <FileWarning className="h-8 w-8 text-danger" />
        <p className="text-sm text-text-secondary">Conversion failed.</p>
        <Button variant="secondary" size="sm" onClick={onBack}>
          <RefreshCw className="h-4 w-4" /> Back to preview
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={handleCopy}>
          <Copy className="h-4 w-4" /> {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="secondary" size="sm" onClick={handleDownloadMd}>
          <Download className="h-4 w-4" /> Download .md
        </Button>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <X className="h-4 w-4" /> Back
        </Button>
      </div>
      <div className="bg-surface-tertiary rounded-lg p-4 overflow-auto max-h-[60vh]">
        <MarkdownRenderer content={markdown} />
      </div>
    </div>
  );
}

/**
 * Modal for previewing and interacting with file attachments.
 * Supports image, PDF, text, document (Pandoc), and unsupported types.
 * @param props - Preview modal configuration.
 * @param props.attachment - The attachment to preview, or null.
 * @param props.open - Whether the modal is visible.
 * @param props.onClose - Callback to close the modal.
 */
export function AttachmentPreview({ attachment, open, onClose }: AttachmentPreviewProps) {
  if (!attachment) return null;

  return (
    <AttachmentPreviewInner
      key={attachment.id}
      attachment={attachment}
      open={open}
      onClose={onClose}
    />
  );
}

function AttachmentPreviewInner({
  attachment,
  open,
  onClose,
}: {
  attachment: AttachmentMeta;
  open: boolean;
  onClose: () => void;
}) {
  const [showMarkdown, setShowMarkdown] = useState(false);

  const previewType = getPreviewType(attachment.mimeType);
  const convertible = canConvertToMarkdown(attachment.mimeType);

  const handleDownload = async () => {
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
    <Modal open={open} onClose={onClose} title={attachment.originalName} size="lg">
      {showMarkdown ? (
        <MarkdownConvertView attachment={attachment} onBack={() => setShowMarkdown(false)} />
      ) : (
        <>
          {previewType === 'image' && <ImagePreview attachment={attachment} />}
          {previewType === 'pdf' && <PdfPreview attachment={attachment} />}
          {previewType === 'text' && <TextPreview attachment={attachment} />}
          {previewType === 'document' && <DocumentPreview attachment={attachment} />}
          {previewType === 'unsupported' && <UnsupportedPreview attachment={attachment} />}
        </>
      )}

      {!showMarkdown && (
        <ModalFooter>
          {convertible && (
            <Button variant="secondary" size="sm" onClick={() => setShowMarkdown(true)}>
              <FileText className="h-4 w-4" /> Convert to Markdown
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4" /> Download
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" /> Close
          </Button>
        </ModalFooter>
      )}
    </Modal>
  );
}
