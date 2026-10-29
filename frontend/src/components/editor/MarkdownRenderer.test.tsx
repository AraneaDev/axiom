import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./MermaidBlock', () => ({ MermaidBlock: () => null }));

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
