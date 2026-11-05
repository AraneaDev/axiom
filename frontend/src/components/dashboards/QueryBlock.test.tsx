import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  render: vi.fn(),
  renderEmbedded: vi.fn(),
  runSavedQuery: vi.fn(),
  runQuery: vi.fn(),
}));
vi.mock('@/api/dashboards.api', () => ({ dashboardsApi: api }));
vi.mock('@/api/client', () => ({ getBlob: vi.fn() }));
vi.mock('@/hooks/useWebSocket', () => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  onReconnect: vi.fn(() => () => {}),
  useRealtimeListener: vi.fn(),
}));
vi.mock('@/components/editor/MermaidBlock', () => ({ MermaidBlock: () => null }));

import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { slashCommandsFor } from '@/components/editor/SlashCommandExtension';

import { QueryBlockScope } from './query-block-scope';
import { QueryBlock } from './QueryBlock';

const COUNT = {
  widgets: [
    {
      id: 'w1',
      type: 'COUNT',
      title: 'Open bugs',
      result: { kind: 'groups', groups: [], total: 7 },
    },
  ],
  projectIds: ['p1'],
};
const ITEMS = { kind: 'items', items: [{ id: 'i1', key: 'AXM-1', title: 'One issue' }] };

function failure(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function wrap(children: ReactNode, pageId: string | null = 'page1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {pageId === null ? (
          children
        ) : (
          <QueryBlockScope value={{ pageId }}>{children}</QueryBlockScope>
        )}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.renderEmbedded.mockResolvedValue(COUNT);
});

describe('MarkdownRenderer live blocks', () => {
  it('renders a block of a page in view mode, through the page', async () => {
    wrap(<MarkdownRenderer content={'Before\n\n:::query dashboard:d1:::\n\nAfter'} />);
    expect(await screen.findByTestId('widget-count')).toHaveTextContent('7');
    expect(screen.getByText('Open bugs')).toBeInTheDocument();
    expect(api.renderEmbedded).toHaveBeenCalledWith('page1', 'dashboard:d1');
    expect(api.render).not.toHaveBeenCalled();
    expect(screen.queryByText(/:::query/)).not.toBeInTheDocument();
    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('hands over an inline query exactly as written', async () => {
    const target = `inline:${JSON.stringify('assignee = @me AND title ~ "a_b_c" AND ^AXM-1 *x* <b>:::')}`;
    wrap(<MarkdownRenderer content={`:::query ${target}:::`} />);
    await screen.findByTestId('widget-count');
    expect(api.renderEmbedded).toHaveBeenCalledWith('page1', target);
  });

  it.each([
    ['a list', '- item\n\n  :::query saved1:::\n\n- other'],
    ['a callout', '> [!NOTE]\n> intro\n>\n> :::query saved1:::'],
    ['a collapsible', '> [!DETAILS] More\n> intro\n>\n> :::query saved1:::'],
    ['a quote', '> quoted\n>\n> :::query saved1:::'],
  ])('renders a block in %s', async (_name, content) => {
    wrap(<MarkdownRenderer content={content} />);
    await screen.findByTestId('widget-count');
    expect(api.renderEmbedded).toHaveBeenCalledWith('page1', 'saved1');
  });

  it.each([
    ['a code block', '```\n:::query saved1:::\n```'],
    ['inline code', 'see `:::query saved1:::`'],
    ['a paragraph', 'text\n:::query saved1:::'],
    ['something that names nothing', ':::query two words:::'],
  ])('leaves %s alone', async (_name, content) => {
    const { container } = wrap(<MarkdownRenderer content={content} />);
    expect(container.textContent).toContain(':::query');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.renderEmbedded).not.toHaveBeenCalled();
  });

  it('shows the line as text outside a page: a comment or an issue runs nothing', async () => {
    const { container } = wrap(<MarkdownRenderer content={':::query dashboard:d1:::'} />, null);
    expect(container.textContent).toContain(':::query dashboard:d1:::');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.renderEmbedded).not.toHaveBeenCalled();
    expect(api.render).not.toHaveBeenCalled();
  });

  it('renders a block written after a mermaid diagram too', async () => {
    wrap(<MarkdownRenderer content={'```mermaid\ngraph TD\n```\n\n:::query saved1:::'} />);
    await screen.findByTestId('widget-count');
  });
});

describe('QueryBlock', () => {
  it('shows the widgets of what it embeds, the failed one with its error', async () => {
    api.renderEmbedded.mockResolvedValue({
      widgets: [
        COUNT.widgets[0],
        {
          id: 'w2',
          type: 'TABLE',
          title: 'Refused',
          result: { error: { status: 400, code: 'INVALID_QUERY', message: 'Could not render' } },
        },
      ],
      projectIds: [],
    });
    wrap(<QueryBlock target="dashboard:d1" />);
    expect(await screen.findByTestId('widget-count')).toHaveTextContent('7');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not render');
  });

  it('says when a dashboard has no widgets', async () => {
    api.renderEmbedded.mockResolvedValue({ widgets: [], projectIds: [] });
    wrap(<QueryBlock target="dashboard:d1" />);
    expect(await screen.findByText('This dashboard has no widgets yet')).toBeInTheDocument();
  });

  describe('a block not saved in the page yet', () => {
    const notOnPage = failure(404, 'This block is not on this page');

    it('falls back on opening the dashboard, with the same rights', async () => {
      api.renderEmbedded.mockRejectedValue(notOnPage);
      api.render.mockResolvedValue({ dashboard: { id: 'd1' }, ...COUNT });
      wrap(<QueryBlock target="dashboard:d1" />);
      expect(await screen.findByTestId('widget-count')).toHaveTextContent('7');
      expect(api.render).toHaveBeenCalledWith('d1');
    });

    it('falls back on running the saved query', async () => {
      api.renderEmbedded.mockRejectedValue(notOnPage);
      api.runSavedQuery.mockResolvedValue(ITEMS);
      wrap(<QueryBlock target="saved1" />);
      expect(await screen.findByText('One issue')).toBeInTheDocument();
      expect(api.runSavedQuery).toHaveBeenCalledWith('saved1');
    });

    it('falls back on running the inline query', async () => {
      api.renderEmbedded.mockRejectedValue(notOnPage);
      api.runQuery.mockResolvedValue(ITEMS);
      wrap(<QueryBlock target={'inline:"type = Bug"'} />);
      expect(await screen.findByText('One issue')).toBeInTheDocument();
      expect(api.runQuery).toHaveBeenCalledWith('type = Bug');
    });

    it('goes straight there on a page that does not exist yet', async () => {
      api.runQuery.mockResolvedValue(ITEMS);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <QueryBlock target={'inline:"type = Bug"'} />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      expect(await screen.findByText('One issue')).toBeInTheDocument();
      expect(api.renderEmbedded).not.toHaveBeenCalled();
    });

    it('shows the refusal when that is refused too', async () => {
      api.renderEmbedded.mockRejectedValue(notOnPage);
      api.render.mockRejectedValue(failure(404, 'Dashboard not found'));
      wrap(<QueryBlock target="dashboard:d1" />);
      expect(await screen.findByRole('alert')).toHaveTextContent('Dashboard not found');
    });
  });

  it('does not try another way when the server failed', async () => {
    api.renderEmbedded.mockRejectedValue(failure(500, 'Server down'));
    wrap(<QueryBlock target="dashboard:d1" />);
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent(
      'Server down',
    );
    await waitFor(() => expect(api.renderEmbedded).toHaveBeenCalled());
    expect(api.render).not.toHaveBeenCalled();
  });

  it('says so for a target that names nothing, and asks nothing', () => {
    wrap(<QueryBlock target="two words" />);
    expect(screen.getByRole('alert')).toHaveTextContent('This block names nothing to show');
    expect(api.renderEmbedded).not.toHaveBeenCalled();
  });
});

describe('slash commands for live blocks', () => {
  const names = (query: string, liveBlocks: boolean) =>
    slashCommandsFor(query, liveBlocks).map((command) => command.name);

  it('offers Dashboard and Query in a wiki page', () => {
    expect(names('dash', true)).toEqual(['Dashboard']);
    expect(names('query', true)).toEqual(['Query']);
  });

  it('does not offer them elsewhere, where the block would never render', () => {
    expect(names('dash', false)).toEqual([]);
    expect(names('query', false)).toEqual([]);
    expect(names('', false)).toContain('Issue Embed');
    expect(names('', false)).not.toContain('Query');
  });
});
