import DOMPurify from 'dompurify';
import {
  Info,
  AlertTriangle,
  StickyNote,
  CheckCircle,
  XCircle,
  ChevronRight,
  List as ListIcon,
} from 'lucide-react';
import { marked, type Token } from 'marked';
import { useMemo, useState } from 'react';

import { MermaidBlock } from './MermaidBlock';

import { cn } from '@/lib/utils';

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
 * Convert image-only paragraphs into inline badge rows.
 * Matches any paragraph whose content is exclusively images
 * (optionally wrapped in links) and replaces the wrapping
 * p tag with a flex div so prose block-img styles don't apply.
 * @param html - The HTML string to process
 * @returns The processed HTML with inline badge rows
 */
function collapseImageParagraphs(html: string): string {
  return html.replace(
    /<p>((?:\s*(?:<a[^>]*>)?\s*<img[^>]*?>\s*(?:<\/a>)?\s*)+)<\/p>/g,
    (match, inner: string) => {
      const imgCount = (inner.match(/<img/g) || []).length;
      if (imgCount < 2) return match;
      return `<div class="badge-row">${inner.trim()}</div>`;
    },
  );
}

function sanitize(raw: string, basePath?: string) {
  const sanitized = DOMPurify.sanitize(raw, {
    ADD_ATTR: [
      'id',
      'data-issue-key',
      'data-callout-type',
      'data-title',
      'data-open',
      'data-collapsible',
      'data-table-of-contents',
      'data-type',
      'data-checked',
    ],
    ADD_TAGS: ['input'],
  });
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

// -- Read-only block components for TipTap custom nodes --

type CalloutType = 'info' | 'warning' | 'note' | 'success' | 'error';

const calloutIcons: Record<CalloutType, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  note: StickyNote,
  success: CheckCircle,
  error: XCircle,
};

const calloutStyles: Record<CalloutType, { border: string; bg: string; icon: string }> = {
  info: {
    border: 'border-l-[var(--color-info)]',
    bg: 'bg-[var(--color-info)]/10',
    icon: 'text-[var(--color-info)]',
  },
  warning: {
    border: 'border-l-[var(--color-warning)]',
    bg: 'bg-[var(--color-warning)]/10',
    icon: 'text-[var(--color-warning)]',
  },
  note: {
    border: 'border-l-[var(--color-primary)]',
    bg: 'bg-[var(--color-primary)]/10',
    icon: 'text-[var(--color-primary)]',
  },
  success: {
    border: 'border-l-[var(--color-success)]',
    bg: 'bg-[var(--color-success)]/10',
    icon: 'text-[var(--color-success)]',
  },
  error: {
    border: 'border-l-[var(--color-danger)]',
    bg: 'bg-[var(--color-danger)]/10',
    icon: 'text-[var(--color-danger)]',
  },
};

function ReadOnlyCallout({ type, html }: { type: CalloutType; html: string }) {
  const Icon = calloutIcons[type] || Info;
  const styles = calloutStyles[type] || calloutStyles.info;
  return (
    <div className={cn('my-3 rounded-r-md border-l-4 p-3 flex gap-3', styles.border, styles.bg)}>
      <Icon className={cn('h-5 w-5 flex-shrink-0 mt-0.5', styles.icon)} />
      <div
        className="flex-1 min-w-0 prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function ReadOnlyCollapsible({
  title,
  html,
  defaultOpen,
}: {
  title: string;
  html: string;
  defaultOpen: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="my-3 rounded-md border border-border bg-surface">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-text hover:bg-surface-secondary rounded-t-md"
        onClick={() => setIsOpen(!isOpen)}
      >
        <ChevronRight
          className={cn('h-4 w-4 transition-transform flex-shrink-0', isOpen && 'rotate-90')}
        />
        {title}
      </button>
      {isOpen && (
        <div
          className="border-t border-border px-3 py-2 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}

function ReadOnlyTableOfContents({
  headings,
}: {
  headings: { level: number; text: string; id: string }[];
}) {
  return (
    <div className="my-3 rounded-md border border-border bg-surface-secondary p-4">
      <div className="flex items-center gap-2 mb-2 text-sm font-medium text-text">
        <ListIcon className="h-4 w-4" />
        Table of Contents
      </div>
      {headings.length === 0 ? (
        <p className="text-sm text-text-tertiary">No headings found.</p>
      ) : (
        <ul className="space-y-1">
          {headings.map((h, i) => (
            <li
              key={`${h.id}-${i}`}
              className={cn('text-sm', h.level === 2 && 'ml-4', h.level === 3 && 'ml-8')}
            >
              <a href={`#${h.id}`} className="text-primary hover:underline">
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Extract TipTap custom blocks from HTML and render them as React components.
 * Handles callouts, collapsibles, and table of contents blocks.
 * @param html
 * @param allHtml
 */
function processCustomBlocks(html: string, allHtml: string): React.ReactNode[] {
  // Parse the full document HTML for headings (used by TOC blocks)
  const tocHeadings: { level: number; text: string; id: string }[] = [];
  const headingRegex = /<h([1-3])\s+id="([^"]*)"[^>]*>(.*?)<\/h\1>/gi;
  let hMatch;
  while ((hMatch = headingRegex.exec(allHtml)) !== null) {
    const level = parseInt(hMatch[1], 10);
    const id = hMatch[2];
    const text = hMatch[3].replace(/<[^>]+>/g, '');
    tocHeadings.push({ level, text, id });
  }

  const parts: React.ReactNode[] = [];
  // Split on custom block patterns
  const blockRegex =
    /(<div\s+data-callout-type="([^"]*)"[^>]*class="callout-block"[^>]*>([\s\S]*?)<\/div>|<div\s+data-collapsible(?:="")?[^>]*data-title="([^"]*)"[^>]*data-open="([^"]*)"[^>]*class="collapsible-block"[^>]*>([\s\S]*?)<\/div>|<div\s+data-table-of-contents(?:="")?[^>]*class="table-of-contents-block"[^>]*>[\s\S]*?<\/div>)/g;

  let lastIndex = 0;
  let match;
  while ((match = blockRegex.exec(html)) !== null) {
    // Add preceding HTML
    if (match.index > lastIndex) {
      const preceding = html.slice(lastIndex, match.index);
      if (preceding.trim()) {
        parts.push(
          <div key={`html-${lastIndex}`} dangerouslySetInnerHTML={{ __html: preceding }} />,
        );
      }
    }

    if (match[2] !== undefined) {
      // Callout block
      parts.push(
        <ReadOnlyCallout
          key={`callout-${match.index}`}
          type={match[2] as CalloutType}
          html={match[3]}
        />,
      );
    } else if (match[4] !== undefined) {
      // Collapsible block
      parts.push(
        <ReadOnlyCollapsible
          key={`collapsible-${match.index}`}
          title={match[4]}
          html={match[6]}
          defaultOpen={match[5] !== 'false'}
        />,
      );
    } else {
      // Table of contents block
      parts.push(<ReadOnlyTableOfContents key={`toc-${match.index}`} headings={tocHeadings} />);
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining HTML
  if (lastIndex < html.length) {
    const remaining = html.slice(lastIndex);
    if (remaining.trim()) {
      parts.push(<div key={`html-${lastIndex}`} dangerouslySetInnerHTML={{ __html: remaining }} />);
    }
  }

  return parts.length > 0 ? parts : [<div key="full" dangerouslySetInnerHTML={{ __html: html }} />];
}

/**
 * Renders markdown content as sanitized HTML with mermaid diagram support.
 * Parses `@mentions` and !ISSUE-123 references into styled links.
 * Mermaid code fences are rendered as interactive diagram blocks.
 * Supports TipTap custom blocks: callouts, collapsibles, task lists, and table of contents.
 * @param props - Renderer configuration.
 * @param props.content - Raw markdown string to render.
 * @param props.className - Additional CSS classes for the wrapper div.
 * @param props.basePath - Base URL path for generating issue reference links (e.g. "/org/team/project").
 */
export function MarkdownRenderer({ content, className = '', basePath }: MarkdownRendererProps) {
  const segments = useMemo(() => parseMarkdown(content || '', basePath), [content, basePath]);

  // Build full HTML for TOC heading extraction
  const fullHtml = useMemo(
    () =>
      segments
        .filter((s) => s.type === 'html')
        .map((s) => s.content)
        .join(''),
    [segments],
  );

  if (!content) return null;

  return (
    <div className={`prose prose-sm max-w-none ${className}`}>
      {segments.map((seg, i) =>
        seg.type === 'html' ? (
          seg.content ? (
            seg.content.includes('data-callout-type') ||
            seg.content.includes('data-collapsible') ||
            seg.content.includes('data-table-of-contents') ? (
              <div key={i}>{processCustomBlocks(seg.content, fullHtml)}</div>
            ) : (
              <div key={i} dangerouslySetInnerHTML={{ __html: seg.content }} />
            )
          ) : null
        ) : (
          <MermaidBlock key={i} code={seg.content} />
        ),
      )}
    </div>
  );
}
