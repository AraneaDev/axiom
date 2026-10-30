import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'a',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'code',
  'pre',
  'blockquote',
  'img',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'div',
  'span',
  'section',
];

const ALLOWED_ATTR = [
  'href',
  'src',
  'alt',
  'title',
  'class',
  'id',
  'target',
  'rel',
  'width',
  'height',
  'colspan',
  'rowspan',
];

/**
 * Sanitize the admin-written landing page HTML with DOMPurify. The hand-written walker it
 * replaces kept event handlers on elements it unwrapped and let `JaVaScript:` or
 * space-prefixed `javascript:` URLs through.
 * @param html - The landing page body
 */
export function sanitizeLandingHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
  // Links open safely whatever their target
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  for (const a of Array.from(doc.querySelectorAll('a')))
    a.setAttribute('rel', 'noopener noreferrer');
  return doc.body.innerHTML;
}
