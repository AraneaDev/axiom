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

function linkifyMentionsAndRefs(html: string): string {
  // Replace @username with styled link
  let result = html.replace(
    /(^|[\s(>])@([a-zA-Z0-9_-]+)/g,
    '$1<span class="mention-ref" style="color:var(--color-primary);font-weight:500">@$2</span>',
  );
  // Replace #PREFIX-123 with styled badge link
  result = result.replace(
    /#([A-Z]+-\d+)/g,
    '<a href="/issues/$1" class="issue-ref-badge" style="color:var(--color-primary);font-weight:500;text-decoration:none">#$1</a>',
  );
  return result;
}

function sanitize(raw: string) {
  const sanitized = DOMPurify.sanitize(raw, { ADD_ATTR: ['id', 'data-issue-key'] });
  const withIssueKeys = sanitized.replace(
    /<span[^>]*data-issue-key="([^"]+)"[^>]*>([^<]*)<\/span>/g,
    (_, key) => `<a href="/issues/${key}" class="issue-ref" data-issue-key="${key}">${key}</a>`,
  );
  return linkifyMentionsAndRefs(withIssueKeys);
}

function parseMarkdown(markdown: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;

  for (const match of markdown.matchAll(MERMAID_FENCE)) {
    if (match.index! > lastIndex) {
      const text = markdown.slice(lastIndex, match.index);
      const raw = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
      segments.push({ type: 'html', content: sanitize(raw) });
    }
    segments.push({ type: 'mermaid', content: match[1].trim() });
    lastIndex = match.index! + match[0].length;
  }

  if (lastIndex < markdown.length) {
    const text = markdown.slice(lastIndex);
    const raw = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
    segments.push({ type: 'html', content: sanitize(raw) });
  }

  return segments;
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 *
 * @param root0
 * @param root0.content
 * @param root0.className
 */
export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const segments = useMemo(() => parseMarkdown(content || ''), [content]);

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
