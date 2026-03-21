const PANDOC_CONVERTIBLE = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/epub+zip',
  'text/html',
  'text/csv',
  'text/x-rst',
  'application/x-latex',
  'text/x-latex',
  'text/org',
]);

export type PreviewType = 'image' | 'pdf' | 'text' | 'unsupported';

/**
 * Determine the preview type for a given MIME type.
 * Only returns previewable types that can render natively in the browser.
 * Document formats (DOCX, ODT, EPUB) are not natively previewable.
 * @param mimeType - The MIME type of the attachment.
 */
export function getPreviewType(mimeType: string): PreviewType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml'
  )
    return 'text';
  return 'unsupported';
}

/**
 * Whether the attachment can be previewed in the browser.
 * @param mimeType - The MIME type of the attachment.
 */
export function canPreview(mimeType: string): boolean {
  return getPreviewType(mimeType) !== 'unsupported';
}

/**
 * Whether the attachment can be converted to Markdown via Pandoc.
 * @param mimeType - The MIME type of the attachment.
 */
export function canConvertToMarkdown(mimeType: string): boolean {
  return PANDOC_CONVERTIBLE.has(mimeType);
}
