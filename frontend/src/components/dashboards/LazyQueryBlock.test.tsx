import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { NodeViewProps } from '@tiptap/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Reading the export is the last step of the block's import(): throwing there rejects it, for the
// import that lazy made, and lets the next attempt succeed
const chunk = vi.hoisted(() => ({ loads: 0, fails: false }));
vi.mock('@/components/dashboards/QueryBlock', () => ({
  get QueryBlock() {
    chunk.loads++;
    if (chunk.fails) throw new TypeError('Failed to fetch dynamically imported module');
    return ({ target }: { target: string }) => <div data-testid="the-block">{target}</div>;
  },
}));
vi.mock('@/api/client', () => ({ getBlob: vi.fn() }));
vi.mock('@/components/editor/MermaidBlock', () => ({ MermaidBlock: () => null }));
vi.mock('@tiptap/react', () => ({
  NodeViewWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import QueryEmbedNode from '@/components/editor/QueryEmbedNode';

import { QueryBlockScope } from './query-block-scope';

const MESSAGE = 'This block could not be loaded';

function page(
  content: string,
  scope: { pageId?: string; editing?: boolean } = { pageId: 'page1' },
) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <QueryBlockScope value={scope}>
        <MarkdownRenderer content={content} />
      </QueryBlockScope>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  chunk.loads = 0;
  chunk.fails = true;
  // React and the boundary report what they caught, which is the point of these tests
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a block whose code cannot be loaded', () => {
  describe('while the page is being edited, where a reload would lose unsaved text', () => {
    const SAVE_FIRST = 'Save the page first, then reload it.';

    const expectNoReload = async () => {
      await screen.findByRole('alert');
      fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
      await screen.findByText(new RegExp(SAVE_FIRST));
      expect(screen.queryByRole('button', { name: /Reload page/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument();
    };

    it('the editor node offers no reload after a failed retry', async () => {
      const props = { node: { attrs: { target: 'dashboard:d1' } } } as unknown as NodeViewProps;
      render(<QueryEmbedNode {...props} />);
      await expectNoReload();
    });

    it('nor does the preview beside the editor', async () => {
      page(':::query dashboard:d1:::', { pageId: 'page1', editing: true });
      await expectNoReload();
    });

    it('still retries first', async () => {
      page(':::query dashboard:d1:::', { pageId: 'page1', editing: true });
      await screen.findByRole('alert');
      chunk.fails = false;
      fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
      expect(await screen.findByTestId('the-block')).toBeInTheDocument();
    });
  });

  it('stays inside the block: the page text stays', async () => {
    page('Text before.\n\n:::query dashboard:d1:::\n\nText after.');
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGE);
    expect(screen.getByText('Text before.')).toBeInTheDocument();
    expect(screen.getByText('Text after.')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('fails each block on its own', async () => {
    page(':::query dashboard:d1:::\n\nBetween.\n\n:::query dashboard:d2:::');
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2), { timeout: 5000 });
    expect(screen.getByText('Between.')).toBeInTheDocument();
  });

  it('loads again on retry, where a cached lazy would throw the same failure', async () => {
    page(':::query dashboard:d1:::');
    await screen.findByRole('alert');
    const failedLoads = chunk.loads;
    chunk.fails = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByTestId('the-block')).toHaveTextContent('dashboard:d1');
    expect(chunk.loads).toBeGreaterThan(failedLoads);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers a reload when the retry fails too, as it does in Chromium', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    page(':::query dashboard:d1:::');
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Reload page/ }));
    expect(reload).toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(MESSAGE);
    expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('is the same in the editor node', async () => {
    const props = { node: { attrs: { target: 'dashboard:d1' } } } as unknown as NodeViewProps;
    render(<QueryEmbedNode {...props} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGE);
    chunk.fails = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByTestId('the-block')).toBeInTheDocument();
  });
});
