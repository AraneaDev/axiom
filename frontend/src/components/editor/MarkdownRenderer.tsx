import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { MermaidBlock } from './MermaidBlock';

// Slug formula must match extractToc in PageView.tsx
function headingSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Custom renderer: add id attributes to headings so TOC anchor links work
const headingRenderer = {
  heading({ tokens, depth }: { tokens: marked.Token[]; depth: number }) {
    const plainText = tokens
      .map((t: any) => ('text' in t ? t.text : 'raw' in t ? t.raw : ''))
      .join('');
    const id = headingSlug(plainText);
    const inner = marked.parseInline(
      tokens.map((t: any) => ('raw' in t ? t.raw : '')).join(''),
      { async: false },
    ) as string;
    return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
  },
};
marked.use({ renderer: headingRenderer });

type Segment = { type: 'html'; content: string } | { type: 'mermaid'; content: string };

const MERMAID_FENCE = /```mermaid\s*\n([\s\S]*?)```/g;

function sanitize(raw: string) {
  const sanitized = DOMPurify.sanitize(raw, { ADD_ATTR: ['id', 'data-issue-key'] });
  return sanitized.replace(
    /<span[^>]*data-issue-key="([^"]+)"[^>]*>([^<]*)<\/span>/g,
    (_, key) => `<a href="/issues/${key}" class="issue-ref" data-issue-key="${key}">${key}</a>`,
  );
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

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const segments = useMemo(() => parseMarkdown(content || ''), [content]);

  if (!content) return null;

  return (
    <div className={`prose prose-sm max-w-none ${className}`}>
      {segments.map((seg, i) =>
        seg.type === 'html' ? (
          seg.content ? <div key={i} dangerouslySetInnerHTML={{ __html: seg.content }} /> : null
        ) : (
          <MermaidBlock key={i} code={seg.content} />
        ),
      )}
    </div>
  );
}
