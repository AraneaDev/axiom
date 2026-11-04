import { ImageOff, Loader2 } from 'lucide-react';

import { useAttachmentObjectUrl } from '@/hooks/useAttachmentObjectUrl';
import { cn } from '@/lib/utils';

interface AttachmentImageProps {
  src: string;
  alt?: string;
  className?: string;
}

/**
 * An image from Markdown. Attachment sources are fetched with auth and shown from a blob
 * URL; while loading it shows a spinner, and a failed load shows a placeholder with the
 * alt text instead of a broken image.
 * @param props - Image source and alt text.
 * @param props.src - The source as written in the Markdown.
 * @param props.alt - Alt text, also the label of the placeholder.
 * @param props.className - Extra classes for the image.
 */
export function AttachmentImage({ src, alt = '', className }: AttachmentImageProps) {
  const { url, error } = useAttachmentObjectUrl(src);

  if (error) {
    return (
      <span
        role="img"
        aria-label={alt || 'Image could not be loaded'}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-secondary px-2 py-1 text-sm text-text-tertiary"
        data-testid="attachment-image-error"
      >
        <ImageOff className="h-4 w-4 flex-shrink-0" />
        {alt || 'Image could not be loaded'}
      </span>
    );
  }

  if (!url) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-md bg-surface-tertiary px-4 py-3"
        data-testid="attachment-image-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
      </span>
    );
  }

  return <img src={url} alt={alt} className={cn('max-w-full', className)} />;
}
