import DOMPurify from 'dompurify';
import { marked, type Token } from 'marked';
import { useMemo } from 'react';

import { MermaidBlock } from './MermaidBlock';

// Slug formula must match extractToc in PageView.tsx
function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Custom renderer: add id attributes to headings so TOC anchor links work
const headingRenderer = {
  heading({ tokens, depth }: { tokens: Token[]; depth: number }) {
    const plainText = tokens
      .map((t: Token) => ('text' in t ? t.text : 'raw' in t ? t.raw : ''))
      .join('');
    const id = headingSlug(plainText);
    const inner = marked.parseInline(tokens.map((t: Token) => ('raw' in t ? t.raw : '')).join(''), {
      async: false,
    }) as string;
    return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
  },
};
marked.use({ renderer: headingRenderer });

type Segment = { type: 'html'; content: string } | { type: 'mermaid'; content: string };

const MERMAID_FENCE = /```mermaid\s*\n([\s\S]*?)```/g;

function linkifyMentionsAndRefs(html: string, basePath?: string): string {
  // Replace @username with styled link
  let result = html.replace(
    /(^|[\s(>])@([a-zA-Z0-9_-]+)/g,
    '$1<span class="mention-ref" style="color:var(--color-primary);font-weight:500">@$2</span>',
  );
  // Replace ^PREFIX-123 issue references with styled badge link
  result = result.replace(/\^([A-Z]+-(\d+))/g, (_match, key, num) => {
    const href = basePath ? `${basePath}/issues/${num}` : `/search?q=${key}`;
    return `<a href="${href}" class="issue-ref-badge" style="color:var(--color-primary);font-weight:500;text-decoration:none">${key}</a>`;
  });
  return result;
}

/**
 * Collapse consecutive image-only paragraphs into a single inline row.
 * This prevents badge/shield images from rendering on separate lines.
 * @param html - The HTML string to process
 * @returns The processed HTML with collapsed image paragraphs
 */
function collapseImageParagraphs(html: string): string {
  return html.replace(
    /(<p>\s*(?:<a[^>]*>)?\s*<img[^>]*>\s*(?:<\/a>)?\s*<\/p>\s*){2,}/g,
    (match) => {
      const images = match.replace(/<\/?p>/g, '').trim();
      return `<div class="badge-row">${images}</div>\n`;
    },
  );
}

function sanitize(raw: string, basePath?: string) {
  const sanitized = DOMPurify.sanitize(raw, { ADD_ATTR: ['id', 'data-issue-key'] });
  const withIssueKeys = sanitized.replace(
    /<span[^>]*data-issue-key="([^"]+)"[^>]*>([^<]*)<\/span>/g,
    (_, key: string) => {
      const num = key.split('-').pop();
      const href = basePath ? `${basePath}/issues/${num}` : `/search?q=${key}`;
      return `<a href="${href}" class="issue-ref" data-issue-key="${key}">${key}</a>`;
    },
  );
  return collapseImageParagraphs(linkifyMentionsAndRefs(withIssueKeys, basePath));
}

function parseMarkdown(markdown: string, basePath?: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;

  for (const match of markdown.matchAll(MERMAID_FENCE)) {
    if (match.index! > lastIndex) {
      const text = markdown.slice(lastIndex, match.index);
      const raw = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
      segments.push({ type: 'html', content: sanitize(raw, basePath) });
    }
    segments.push({ type: 'mermaid', content: match[1].trim() });
    lastIndex = match.index! + match[0].length;
  }

  if (lastIndex < markdown.length) {
    const text = markdown.slice(lastIndex);
    const raw = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
    segments.push({ type: 'html', content: sanitize(raw, basePath) });
  }

  return segments;
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
  basePath?: string;
}

/**
 * Renders markdown content as sanitized HTML with mermaid diagram support.
 * Parses `@mentions` and !ISSUE-123 references into styled links.
 * Mermaid code fences are rendered as interactive diagram blocks.
 * @param props - Renderer configuration.
 * @param props.content - Raw markdown string to render.
 * @param props.className - Additional CSS classes for the wrapper div.
 * @param props.basePath - Base URL path for generating issue reference links (e.g. "/org/team/project").
 */
export function MarkdownRenderer({ content, className = '', basePath }: MarkdownRendererProps) {
  const segments = useMemo(() => parseMarkdown(content || '', basePath), [content, basePath]);

  if (!content) return null;

  return (
    <div className={`prose prose-sm max-w-none ${className}`}>
      {segments.map((seg, i) =>
        seg.type === 'html' ? (
          seg.content ? (
            <div key={i} dangerouslySetInnerHTML={{ __html: seg.content }} />
          ) : null
        ) : (
          <MermaidBlock key={i} code={seg.content} />
        ),
      )}
    </div>
  );
}
