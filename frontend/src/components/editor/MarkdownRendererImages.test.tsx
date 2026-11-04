import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./MermaidBlock', () => ({ MermaidBlock: () => null }));

const mockFetchWithAuth = vi.fn();
vi.mock('@/api/client', () => ({
  fetchWithAuth: (...args: unknown[]) => mockFetchWithAuth(...args),
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
    mockFetchWithAuth.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:test/1');
    URL.revokeObjectURL = vi.fn();
  });

  it('shows an attachment image from a blob URL, never from the raw attachment path', async () => {
    mockFetchWithAuth.mockResolvedValue({ ok: true, blob: async () => new Blob(['x']) });
    const { container } = renderMarkdown('Before ![a chart](/api/attachments/abc123) after');
    expect(container.querySelector('img[src^="/api/attachments"]')).toBeNull();
    await waitFor(() =>
      expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:test/1'),
    );
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('a chart');
    expect(mockFetchWithAuth).toHaveBeenCalledWith('/api/attachments/abc123');
  });

  it('shows a placeholder with the alt text when the attachment cannot be loaded', async () => {
    mockFetchWithAuth.mockResolvedValue({ ok: false, status: 404 });
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
    expect(mockFetchWithAuth).not.toHaveBeenCalled();
  });

  it('renders attachment images inside callouts', async () => {
    mockFetchWithAuth.mockResolvedValue({ ok: true, blob: async () => new Blob(['x']) });
    const { container } = renderMarkdown('> [!NOTE]\n> ![inside](/api/attachments/abc123)');
    await waitFor(() =>
      expect(container.querySelector('[data-callout-type] img, .border-l-4 img')).not.toBeNull(),
    );
  });
});
