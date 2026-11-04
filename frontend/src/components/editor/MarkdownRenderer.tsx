/* eslint-disable react/no-danger -- Renderer component: all HTML is DOMPurify-sanitized */
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
import { createPortal } from 'react-dom';

import { attachmentIdOf } from '@/hooks/useAttachmentObjectUrl';
import { cn } from '@/lib/utils';

import { AttachmentImage } from './AttachmentImage';
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

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Attachment images need the auth header, which an <img> cannot send: leave a slot that
// HtmlContent fills with an AttachmentImage. Other images use marked's default.
const imageRenderer = {
  image({ href, text }: { href: string; text: string }) {
    if (attachmentIdOf(href) === null) return false;
    return `<span class="attachment-image-slot" data-attachment-src="${escapeAttr(href)}" data-alt="${escapeAttr(text)}"></span>`;
  },
};
marked.use({ renderer: { ...headingRenderer, ...imageRenderer } });

type Segment = { type: 'html'; content: string } | { type: 'mermaid'; content: string };

interface ImageSlot {
  el: HTMLElement;
  src: string;
  alt: string;
}

/**
 * Sanitized HTML from the renderer. Attachment image slots in it are filled with
 * AttachmentImage, which loads the file with auth and shows it from a blob URL.
 * @param props - The HTML and wrapper classes.
 * @param props.html - Sanitized HTML.
 * @param props.className - Classes for the wrapper div.
 */
function HtmlContent({ html, className }: { html: string; className?: string }) {
  // The wrapper is remounted when the HTML changes (key), so its slots are always current
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const slots = useMemo<ImageSlot[]>(() => {
    if (!container) return [];
    return (
      Array.from(container.querySelectorAll<HTMLElement>('span[data-attachment-src]'))
        .map((el) => ({ el, src: el.dataset.attachmentSrc ?? '', alt: el.dataset.alt ?? '' }))
        // Raw HTML can write this span too: only attachment paths may be fetched
        .filter((slot) => attachmentIdOf(slot.src) !== null)
    );
  }, [container]);
  // A new object every render would make React write the HTML again, wiping the filled slots
  const innerHtml = useMemo(() => ({ __html: html }), [html]);

  return (
    <>
      <div
        key={html}
        ref={setContainer}
        className={className}
        dangerouslySetInnerHTML={innerHtml}
      />
      {slots.map((slot, i) =>
        createPortal(
          <AttachmentImage src={slot.src} alt={slot.alt} />,
          slot.el,
          `${slot.src}-${i}`,
        ),
      )}
    </>
  );
}

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
      'checked',
      'disabled',
      'type',
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
  // Add task-list classes to <ul>/<li> elements containing checkboxes
  const withTaskLists = collapseImageParagraphs(linkifyMentionsAndRefs(withIssueKeys, basePath));
  return withTaskLists
    .replace(/<li>((?:\s*<p>)?\s*<input[^>]*?type="checkbox")/gi, '<li class="task-list-item">$1')
    .replace(/<ul>([\s\S]*?<li class="task-list-item")/g, '<ul class="task-list">$1');
}

/**
 * Parse HTML into a detached element of an inert document (no browsing context):
 * images do not load and event handlers never run, whatever the HTML contains.
 * @param html - HTML to parse.
 * @returns A container element holding the parsed nodes.
 */
function inertContainer(html: string): HTMLElement {
  const container = document.implementation.createHTMLDocument('').createElement('div');
  container.innerHTML = html;
  return container;
}

/** Same pattern the editor's issue embed node parses. */
const ISSUE_EMBED_LINE = /^:::issue\s+([A-Z]+-\d+):::$/;

const GFM_ALERT_TYPES: Record<string, string> = {
  NOTE: 'info',
  WARNING: 'warning',
  TIP: 'success',
  CAUTION: 'error',
  IMPORTANT: 'warning',
};

/**
 * Transform GFM alert blockquotes, [TOC] markers and issue embed lines in rendered HTML
 * into custom block elements that processCustomBlocks can handle.
 * Converts `> [!NOTE]` blockquotes into callout divs, `> [!DETAILS]` into
 * collapsible divs, `[TOC]` paragraphs into table-of-contents divs, and
 * `:::issue KEY:::` paragraphs into `^KEY` references (rendered as badge links).
 * @param html
 */
function transformGfmAlerts(html: string): string {
  // Runs before DOMPurify: parse in an inert document so nothing in the raw HTML loads or runs
  const container = inertContainer(html);
  const doc = container.ownerDocument;

  container.querySelectorAll('blockquote').forEach((bq) => {
    // Only the quote's own first block: a nested quote's paragraph is not this quote's marker
    const firstP = bq.firstElementChild?.tagName === 'P' ? bq.firstElementChild : null;
    if (!firstP) return;
    const firstNode = firstP.childNodes[0];
    if (!firstNode || firstNode.nodeType !== Node.TEXT_NODE) return;
    const text = firstNode.textContent || '';

    const alertMatch = text.match(/^\[!(NOTE|WARNING|TIP|CAUTION|IMPORTANT)\]\s*/);
    const detailsMatch = !alertMatch ? text.match(/^\[!DETAILS\]\s*(.*?)(?:\n|$)/) : null;

    if (alertMatch) {
      firstNode.textContent = text.slice(alertMatch[0].length);
      if (!firstNode.textContent.trim()) {
        if (firstNode.nextSibling?.nodeName === 'BR') firstNode.nextSibling.remove();
        if (!firstNode.textContent) firstNode.remove();
      }
      if (!firstP.innerHTML.trim()) firstP.remove();
      const div = doc.createElement('div');
      div.setAttribute('data-callout-type', GFM_ALERT_TYPES[alertMatch[1]] || 'info');
      div.innerHTML = bq.innerHTML;
      bq.replaceWith(div);
    } else if (detailsMatch) {
      const title = detailsMatch[1].trim() || 'Click to expand';
      firstNode.textContent = text.slice(detailsMatch[0].length);
      if (!firstNode.textContent.trim()) {
        if (firstNode.nextSibling?.nodeName === 'BR') firstNode.nextSibling.remove();
        if (!firstNode.textContent) firstNode.remove();
      }
      if (!firstP.innerHTML.trim()) firstP.remove();
      const div = doc.createElement('div');
      div.setAttribute('data-collapsible', '');
      div.setAttribute('data-title', title);
      div.setAttribute('data-open', 'true');
      div.innerHTML = bq.innerHTML;
      bq.replaceWith(div);
    }
  });

  container.querySelectorAll('p').forEach((p) => {
    if (p.textContent?.trim() === '[TOC]') {
      const div = doc.createElement('div');
      div.setAttribute('data-table-of-contents', '');
      p.replaceWith(div);
      return;
    }
    // `:::issue AXM-12:::` (the editor's issue embed): render it as the `^KEY` badge link
    const embed = p.textContent?.trim().match(ISSUE_EMBED_LINE);
    if (embed) p.textContent = `^${embed[1]}`;
  });

  return container.innerHTML;
}

function parseMarkdown(markdown: string, basePath?: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;

  for (const match of markdown.matchAll(MERMAID_FENCE)) {
    if (match.index! > lastIndex) {
      const text = markdown.slice(lastIndex, match.index);
      const raw = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
      segments.push({ type: 'html', content: sanitize(transformGfmAlerts(raw), basePath) });
    }
    segments.push({ type: 'mermaid', content: match[1].trim() });
    lastIndex = match.index! + match[0].length;
  }

  if (lastIndex < markdown.length) {
    const text = markdown.slice(lastIndex);
    const raw = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
    segments.push({ type: 'html', content: sanitize(transformGfmAlerts(raw), basePath) });
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
    border: 'border-l-primary',
    bg: 'bg-primary/10',
    icon: 'text-primary',
  },
  warning: {
    border: 'border-l-warning',
    bg: 'bg-warning/10',
    icon: 'text-warning',
  },
  note: {
    border: 'border-l-primary',
    bg: 'bg-primary/10',
    icon: 'text-primary',
  },
  success: {
    border: 'border-l-success',
    bg: 'bg-success/10',
    icon: 'text-success',
  },
  error: {
    border: 'border-l-danger',
    bg: 'bg-danger/10',
    icon: 'text-danger',
  },
};

function ReadOnlyCallout({ type, html }: { type: CalloutType; html: string }) {
  const Icon = calloutIcons[type] || Info;
  const styles = calloutStyles[type] || calloutStyles.info;
  return (
    <div className={cn('my-3 rounded-r-md border-l-4 p-3 flex gap-3', styles.border, styles.bg)}>
      <Icon className={cn('h-5 w-5 flex-shrink-0 mt-0.5', styles.icon)} />
      <HtmlContent html={html} className="flex-1 min-w-0 prose prose-sm max-w-none" />
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
        <HtmlContent
          html={html}
          className="border-t border-border px-3 py-2 prose prose-sm max-w-none"
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
  const tocParser = inertContainer(allHtml);
  tocParser.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el) => {
    const level = parseInt(el.tagName[1], 10);
    const text = el.textContent || '';
    const id = el.id || headingSlug(text);
    if (text.trim()) {
      tocHeadings.push({ level, text, id });
    }
  });

  const parts: React.ReactNode[] = [];

  // Use a DOM parser for reliable attribute extraction instead of fragile regexes
  const tempDiv = inertContainer(html);

  // Walk top-level children and identify custom blocks
  let htmlBuffer = '';
  let partIndex = 0;

  const flushBuffer = () => {
    if (htmlBuffer.trim()) {
      parts.push(<HtmlContent key={`html-${partIndex++}`} html={htmlBuffer} />);
    }
    htmlBuffer = '';
  };

  for (const child of Array.from(tempDiv.childNodes)) {
    if (child instanceof HTMLElement) {
      if (child.hasAttribute('data-callout-type') || child.classList.contains('callout-block')) {
        flushBuffer();
        const type = (child.getAttribute('data-callout-type') ||
          child.getAttribute('data-type') ||
          'info') as CalloutType;
        parts.push(
          <ReadOnlyCallout key={`callout-${partIndex++}`} type={type} html={child.innerHTML} />,
        );
        continue;
      }

      if (child.hasAttribute('data-collapsible') || child.classList.contains('collapsible-block')) {
        flushBuffer();
        const title = child.getAttribute('data-title') || 'Click to expand';
        const open = child.getAttribute('data-open') !== 'false';
        parts.push(
          <ReadOnlyCollapsible
            key={`collapsible-${partIndex++}`}
            title={title}
            html={child.innerHTML}
            defaultOpen={open}
          />,
        );
        continue;
      }

      if (
        child.hasAttribute('data-table-of-contents') ||
        child.classList.contains('table-of-contents-block')
      ) {
        flushBuffer();
        parts.push(<ReadOnlyTableOfContents key={`toc-${partIndex++}`} headings={tocHeadings} />);
        continue;
      }
    }

    // Regular HTML node -- accumulate
    if (child instanceof HTMLElement) {
      htmlBuffer += child.outerHTML;
    } else if (child.textContent?.trim()) {
      htmlBuffer += child.textContent;
    }
  }

  flushBuffer();

  return parts.length > 0 ? parts : [<HtmlContent key="full" html={html} />];
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
              <HtmlContent key={i} html={seg.content} />
            )
          ) : null
        ) : (
          <MermaidBlock key={i} code={seg.content} />
        ),
      )}
    </div>
  );
}
