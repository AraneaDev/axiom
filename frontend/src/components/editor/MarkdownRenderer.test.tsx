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
