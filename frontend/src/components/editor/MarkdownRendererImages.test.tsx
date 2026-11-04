import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./MermaidBlock', () => ({ MermaidBlock: () => null }));

const mockGetBlob = vi.fn();
vi.mock('@/api/client', () => ({
  getBlob: (...args: unknown[]) => mockGetBlob(...args),
}));

import { MarkdownRenderer } from './MarkdownRenderer';

function renderMarkdown(content: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MarkdownRenderer content={content} />
    </QueryClientProvider>,
  );
}

describe('MarkdownRenderer images', () => {
  beforeEach(() => {
    mockGetBlob.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:test/1');
    URL.revokeObjectURL = vi.fn();
  });

  it('shows an attachment image from a blob URL, never from the raw attachment path', async () => {
    mockGetBlob.mockResolvedValue(new Blob(['x']));
    const { container } = renderMarkdown('Before ![a chart](/api/attachments/abc123) after');
    expect(container.querySelector('img[src^="/api/attachments"]')).toBeNull();
    await waitFor(() =>
      expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:test/1'),
    );
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('a chart');
    expect(mockGetBlob).toHaveBeenCalledWith('/api/attachments/abc123');
  });

  it('shows a placeholder with the alt text when the attachment cannot be loaded', async () => {
    mockGetBlob.mockRejectedValue(new Error('404'));
    const { container, findByTestId } = renderMarkdown('![missing file](/api/attachments/gone)');
    const placeholder = await findByTestId('attachment-image-error');
    expect(placeholder.textContent).toContain('missing file');
    expect(container.querySelector('img')).toBeNull();
  });

  it('leaves external images as normal images', () => {
    const { container } = renderMarkdown('![logo](https://example.com/logo.png)');
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/logo.png',
    );
    expect(mockGetBlob).not.toHaveBeenCalled();
  });

  it('renders attachment images inside callouts', async () => {
    mockGetBlob.mockResolvedValue(new Blob(['x']));
    const { container } = renderMarkdown('> [!NOTE]\n> ![inside](/api/attachments/abc123)');
    await waitFor(() =>
      expect(container.querySelector('[data-callout-type] img, .border-l-4 img')).not.toBeNull(),
    );
  });

  it('never fetches a source that is not an attachment path, even from a raw span', () => {
    const { container } = renderMarkdown(
      '<span class="attachment-image-slot" data-attachment-src="https://evil.test/x.png" data-alt="x"></span>',
    );
    expect(mockGetBlob).not.toHaveBeenCalled();
    expect(container.querySelector('img')).toBeNull();
  });
});
