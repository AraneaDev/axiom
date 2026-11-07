import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./MermaidBlock', () => ({ MermaidBlock: () => null }));
vi.mock('@/api/client', () => ({ getBlob: vi.fn() }));

import { QueryBlockScope } from '@/components/dashboards/query-block-scope';

import { MarkdownRenderer } from './MarkdownRenderer';

describe('MarkdownRenderer issue embeds', () => {
  it('renders an issue embed line as an issue badge link', () => {
    const { container } = render(
      <MarkdownRenderer
        content={'Before\n\n:::issue AXM-12:::\n\nAfter'}
        basePath="/aranea/axiom/AXM"
      />,
    );
    const link = container.querySelector('a.issue-ref-badge');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/aranea/axiom/AXM/issues/12');
    expect(link?.textContent).toBe('AXM-12');
    expect(container.textContent).not.toContain(':::issue');
  });

  it('links to search without a base path', () => {
    const { container } = render(<MarkdownRenderer content={':::issue AXM-3:::'} />);
    expect(container.querySelector('a.issue-ref-badge')?.getAttribute('href')).toBe(
      '/search?q=AXM-3',
    );
  });

  it('leaves other ::: lines as text', () => {
    const { container } = render(<MarkdownRenderer content={':::foo bar:::'} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain(':::foo bar:::');
  });
});

describe('MarkdownRenderer sanitising', () => {
  const body = [
    '# Title',
    '<img src=x onerror="window.__xss=1">',
    '<svg onload="window.__xss=1"></svg>',
    '> [!WARNING]\n> careful <img src=y onerror="window.__xss=1">',
    '[TOC]',
  ].join('\n\n');

  it('never parses unsanitised HTML into the live document', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!;
    const liveAssignments: string[] = [];
    const spy = vi.spyOn(Element.prototype, 'innerHTML', 'set').mockImplementation(function (
      this: Element,
      value: string,
    ) {
      if (this.ownerDocument === document) liveAssignments.push(String(value));
      descriptor.set!.call(this, value);
    });
    try {
      render(<MarkdownRenderer content={body} />);
    } finally {
      spy.mockRestore();
    }
    expect(liveAssignments.filter((v) => /onerror|onload/i.test(v))).toEqual([]);
  });

  it('renders no event handler attributes and runs no script', () => {
    const { container } = render(<MarkdownRenderer content={body} />);
    expect(container.querySelector('[onerror], [onload]')).toBeNull();
    expect(container.innerHTML).not.toMatch(/onerror|onload/i);
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });
});

describe('MarkdownRenderer live blocks in code', () => {
  it('shows a fenced :::query line as code, also where blocks run', () => {
    const { container } = render(
      <QueryBlockScope value={{ pageId: 'page1' }}>
        <MarkdownRenderer content={'```\n:::query dashboard:cm1dash45:::\n```'} />
      </QueryBlockScope>,
    );
    expect(container.querySelector('pre code')?.textContent).toBe(
      ':::query dashboard:cm1dash45:::\n',
    );
    expect(container.querySelector('[data-query-embed]')).toBeNull();
    expect(container.querySelector('[data-testid="query-block-loading"]')).toBeNull();
  });
});

describe('MarkdownRenderer escaped GitHub text', () => {
  // A hostile pull request title as the automation escapes it for a comment
  const escaped =
    'https\\://3232235777/login \\:\\:\\:query x\\:\\:\\: \\@tim \\^AXM\\-1 \\# Heading';

  it('renders it as literal text with no link, embed, mention or issue badge', () => {
    const { container } = render(<MarkdownRenderer content={escaped} basePath="/a/b/AXM" />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('.mention-ref')).toBeNull();
    expect(container.querySelector('.issue-ref-badge')).toBeNull();
    expect(container.querySelector('h1')).toBeNull();
    expect(container.textContent).toContain('https://3232235777/login');
    expect(container.textContent).toContain(':::query x:::');
    expect(container.textContent).toContain('@tim ^AXM-1 # Heading');
  });

  it('does not style a lone escaped mention or issue key', () => {
    const { container } = render(<MarkdownRenderer content={'\\@tim \\^AXM-1'} />);
    expect(container.querySelector('.mention-ref')).toBeNull();
    expect(container.querySelector('.issue-ref-badge')).toBeNull();
  });
});

describe('MarkdownRenderer mentions and issue keys agree with the notifier', () => {
  const mentions = (content: string) =>
    Array.from(
      render(<MarkdownRenderer content={content} basePath="/a/b/AXM" />).container.querySelectorAll(
        '.mention-ref',
      ),
    ).map((el) => el.textContent);
  const keys = (content: string) =>
    Array.from(
      render(<MarkdownRenderer content={content} basePath="/a/b/AXM" />).container.querySelectorAll(
        'a.issue-ref-badge',
      ),
    ).map((el) => el.textContent);

  it('styles a mention at the start, after punctuation and after markup', () => {
    expect(mentions('@alice')).toEqual(['@alice']);
    expect(mentions('(@alice) "@bob" ,@carl')).toEqual(['@alice', '@bob', '@carl']);
    expect(mentions('**@alice**')).toEqual(['@alice']);
  });

  it('styles nothing for an email address', () => {
    expect(mentions('mail a@b.com now')).toEqual([]);
  });

  it('styles a mention after an even number of backslashes', () => {
    expect(mentions('\\\\@tim')).toEqual(['@tim']);
    expect(mentions('\\@tim')).toEqual([]);
    expect(mentions('\\\\\\@tim')).toEqual([]);
  });

  it('styles nothing inside inline code or a code block', () => {
    expect(mentions('`@tim` and ```@tim```')).toEqual([]);
    expect(mentions('```\n@tim ^AXM-1\n```')).toEqual([]);
    expect(keys('`^AXM-1`')).toEqual([]);
    expect(mentions('see `x` then @tim')).toEqual(['@tim']);
  });

  it('styles the key forms the notifier reads, and not an escaped one', () => {
    expect(keys('^AXM-1 and #AXM-2')).toEqual(['AXM-1', 'AXM-2']);
    expect(keys('\\^AXM-1 \\#AXM-2')).toEqual([]);
  });

  it('leaves an attribute alone', () => {
    const { container } = render(<MarkdownRenderer content={'[x](https://acme.invalid/@tim)'} />);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://acme.invalid/@tim');
  });
});
