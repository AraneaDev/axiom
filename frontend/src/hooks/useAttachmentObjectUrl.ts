import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getBlob } from '@/api/client';

const ATTACHMENT_SRC = /^\/api\/attachments\/([A-Za-z0-9_-]+)$/;

/**
 * The attachment id of an `/api/attachments/<id>` source.
 * @param src - An image source from Markdown.
 * @returns The id, or null for any other source.
 */
export function attachmentIdOf(src: string): string | null {
  return ATTACHMENT_SRC.exec(src)?.[1] ?? null;
}

/**
 * Resolve an image source for an `<img>`. Attachment sources need the auth header, which an
 * `<img>` cannot send, so the file is fetched through the API client and shown from a blob
 * URL. The blob is cached by TanStack Query (one fetch per attachment); each hook instance
 * makes its own object URL from it and revokes that URL on unmount or when the source
 * changes. Other sources pass through unchanged. Blob URLs are only ever used as `<img>`
 * sources, so an SVG attachment cannot run scripts.
 * @param src - The image source as written in the Markdown.
 * @returns The URL to show (null while loading or on failure) and whether loading failed.
 */
export function useAttachmentObjectUrl(src: string): { url: string | null; error: boolean } {
  const id = attachmentIdOf(src);
  const { data: blob, isError } = useQuery({
    queryKey: ['attachment-blob', id],
    queryFn: () => getBlob(`/api/attachments/${id}`),
    enabled: id !== null,
    staleTime: Infinity,
  });
  const [made, setMade] = useState<{ blob: Blob; url: string } | null>(null);

  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    // Syncing with an external resource: the object URL lives exactly as long as this effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMade({ blob, url });
    return () => {
      URL.revokeObjectURL(url);
      setMade(null);
    };
  }, [blob]);

  if (id === null) return { url: src, error: false };
  if (isError) return { url: null, error: true };
  return { url: blob && made?.blob === blob ? made.url : null, error: false };
}
