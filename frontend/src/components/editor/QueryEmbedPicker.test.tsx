import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ dashboards: vi.fn(), saved: vi.fn() }));
vi.mock('@/api/dashboards.api', () => ({ dashboardsApi: { list: api.dashboards } }));
vi.mock('@/api/saved-filters.api', () => ({ savedFiltersApi: { list: api.saved } }));

import { QueryEmbedPicker, type QueryEmbedSource } from './QueryEmbedPicker';

const onPick = vi.fn();
const onClose = vi.fn();

function open(source: QueryEmbedSource) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <QueryEmbedPicker source={source} onPick={onPick} onClose={onClose} />
    </QueryClientProvider>,
  );
  return screen.getByRole('dialog');
}

const add = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: /Add block/ });

async function choose(dialog: HTMLElement, testId: string, option: string) {
  const picker = await within(dialog).findByTestId(testId);
  fireEvent.click(within(picker).getByRole('button'));
  fireEvent.click(await within(picker).findByText(option));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.dashboards.mockResolvedValue([
    { id: 'd1', name: 'Monday overview' },
    { id: 'd2', name: 'Release' },
  ]);
  api.saved.mockResolvedValue([
    { id: 's1', name: 'Open bugs', query: { kind: 'query', text: 'type = Bug' } },
    { id: 's2', name: 'Issue list preset', query: { status: 'open' } },
  ]);
});

describe('QueryEmbedPicker', () => {
  it('picks a dashboard from the list of what the viewer may open', async () => {
    const dialog = open('dashboard');
    expect(add(dialog)).toBeDisabled();
    await choose(dialog, 'dashboard-picker', 'Monday overview');
    fireEvent.click(add(dialog));
    expect(onPick).toHaveBeenCalledWith('dashboard:d1');
  });

  it('picks a saved query, and only those written as text', async () => {
    const dialog = open('saved');
    const picker = await within(dialog).findByTestId('saved-query-picker');
    fireEvent.click(within(picker).getByRole('button'));
    expect(await within(picker).findByText('Open bugs')).toBeInTheDocument();
    expect(within(picker).queryByText('Issue list preset')).not.toBeInTheDocument();
    fireEvent.click(within(picker).getByText('Open bugs'));
    fireEvent.click(add(dialog));
    expect(onPick).toHaveBeenCalledWith('s1');
  });

  it('takes a typed query as a query, whatever it looks like', () => {
    const dialog = open('inline');
    expect(add(dialog)).toBeDisabled();
    const typed = 'cmaaaaaaaaaaaaaaaaaaaaaaa';
    fireEvent.change(within(dialog).getByLabelText('Query'), { target: { value: ` ${typed} ` } });
    fireEvent.click(add(dialog));
    expect(onPick).toHaveBeenCalledWith(`inline:"${typed}"`);
  });

  it('quotes a query so that the block stays one line', () => {
    const dialog = open('inline');
    fireEvent.change(within(dialog).getByLabelText('Query'), {
      target: { value: 'title ~ "a"\nAND type = Bug' },
    });
    fireEvent.click(add(dialog));
    expect(onPick).toHaveBeenCalledWith('inline:"title ~ \\"a\\"\\nAND type = Bug"');
  });

  it('switches between the three', async () => {
    const dialog = open('dashboard');
    fireEvent.click(within(dialog).getByRole('button', { name: /Inline query/ }));
    expect(within(dialog).getByLabelText('Query')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /Saved query/ }));
    expect(await within(dialog).findByTestId('saved-query-picker')).toBeInTheDocument();
    expect(add(dialog)).toBeDisabled();
  });

  it('says when there is nothing to pick', async () => {
    api.dashboards.mockResolvedValue([]);
    const dialog = open('dashboard');
    expect(await within(dialog).findByText('You have no dashboards yet')).toBeInTheDocument();
  });

  it('only loads the list it shows', async () => {
    open('dashboard');
    await waitFor(() => expect(api.dashboards).toHaveBeenCalled());
    expect(api.saved).not.toHaveBeenCalled();
  });

  it('adds nothing on cancel', () => {
    const dialog = open('inline');
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/ }));
    expect(onClose).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });
});
