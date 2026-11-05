import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  render: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  addWidget: vi.fn(),
  updateWidget: vi.fn(),
  removeWidget: vi.fn(),
  reorderWidgets: vi.fn(),
}));

vi.mock('@/api/dashboards.api', () => ({ dashboardsApi: api }));
const savedApi = vi.hoisted(() => ({ createQuery: vi.fn() }));

vi.mock('@/api/saved-filters.api', () => ({
  savedFiltersApi: {
    createQuery: savedApi.createQuery,
    list: () =>
      Promise.resolve([
        { id: 'q1', name: 'Open bugs', query: { kind: 'query', text: 'type = BUG' } },
        { id: 'q2', name: 'Issue list preset', query: { type: 'BUG' } },
      ]),
  },
}));
vi.mock('@/api/orgs.api', () => ({
  orgsApi: { list: () => Promise.resolve([{ id: 'o1', name: 'Example Org' }]) },
}));
vi.mock('@/api/teams.api', () => ({
  teamsApi: { listByOrg: () => Promise.resolve([{ id: 't1', name: 'Core' }]) },
}));
vi.mock('@/hooks/useWebSocket', () => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  useRealtimeListener: vi.fn(),
  onReconnect: () => () => {},
}));

import { ToastProvider } from '@/components/ui/Toast';

import DashboardEdit from './DashboardEdit';
import DashboardList from './DashboardList';
import DashboardView from './DashboardView';

function renderAt(url: string, client = newClient()) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/dashboards" element={<DashboardList />} />
            <Route path="/dashboards/:id" element={<DashboardView />} />
            <Route path="/dashboards/:id/edit" element={<DashboardEdit />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const failure = (status: number, message: string) => Object.assign(new Error(message), { status });

const dashboard = {
  id: 'd1',
  name: 'Team health',
  description: 'How the team is doing',
  ownerId: 'u1',
  visibility: 'PRIVATE' as const,
  teamId: null,
  orgId: null,
  layout: { columns: 2 },
  canEdit: true,
};

const widgets = [
  { id: 'w1', type: 'COUNT', title: 'Bugs', savedQueryId: null, query: 'type = BUG', position: 0 },
  { id: 'w2', type: 'SPRINT_OVERVIEW', title: 'Sprints', savedQueryId: null, query: null },
  { id: 'w3', type: 'LIST', title: 'Saved', savedQueryId: 'q1', query: null, position: 2 },
];

describe('dashboard pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ ...dashboard, widgets });
  });

  describe('DashboardList', () => {
    it('links to each dashboard', async () => {
      api.list.mockResolvedValue([{ ...dashboard, widgetCount: 3 }]);
      renderAt('/dashboards');
      expect(await screen.findByRole('link', { name: /Team health/ })).toHaveAttribute(
        'href',
        '/dashboards/d1',
      );
    });

    it('offers to make the first one when there are none', async () => {
      api.list.mockResolvedValue([]);
      renderAt('/dashboards');
      expect(await screen.findByText('No dashboards yet')).toBeInTheDocument();
    });

    it('creates one and asks for a name first', async () => {
      api.list.mockResolvedValue([]);
      api.create.mockResolvedValue({ ...dashboard, id: 'd2' });
      renderAt('/dashboards');
      fireEvent.click((await screen.findAllByRole('button', { name: /New dashboard/ }))[0]);
      const dialog = await screen.findByRole('dialog');
      const submit = within(dialog).getByRole('button', { name: /Create/ });
      expect(submit).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Mine' } });
      fireEvent.click(submit);
      await waitFor(() =>
        expect(api.create).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'Mine', visibility: 'PRIVATE' }),
        ),
      );
    });

    it('shows an error when the list fails', async () => {
      api.list.mockRejectedValue(new Error('Nope'));
      renderAt('/dashboards');
      expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
    });
  });

  describe('DashboardView', () => {
    const rendered = {
      dashboard,
      projectIds: ['p1'],
      widgets: [
        {
          id: 'w1',
          type: 'COUNT',
          title: 'Bugs',
          result: { kind: 'groups', total: 4, groups: [] },
        },
        {
          id: 'w2',
          type: 'LIST',
          title: 'Lost',
          result: { error: { status: 404, code: 'ERROR', message: 'Saved query not found' } },
        },
      ],
    };

    it('renders every widget, the failed one with its error', async () => {
      api.render.mockResolvedValue(rendered);
      renderAt('/dashboards/d1');
      expect(await screen.findByTestId('widget-count')).toHaveTextContent('4');
      expect(screen.getByRole('alert')).toHaveTextContent('Saved query not found');
    });

    it('lays the grid out in the columns the dashboard asks for', async () => {
      api.render.mockResolvedValue(rendered);
      renderAt('/dashboards/d1');
      await screen.findByTestId('widget-count');
      expect(screen.getByTestId('dashboard-grid').className).toContain('xl:grid-cols-2');
    });

    it('offers editing only to who may edit', async () => {
      api.render.mockResolvedValue({ ...rendered, dashboard: { ...dashboard, canEdit: false } });
      renderAt('/dashboards/d1');
      await screen.findByTestId('widget-count');
      expect(screen.queryByRole('link', { name: /Edit/ })).not.toBeInTheDocument();
    });

    it('links to the edit page for who may edit', async () => {
      api.render.mockResolvedValue(rendered);
      renderAt('/dashboards/d1');
      expect(await screen.findByRole('link', { name: /Edit/ })).toHaveAttribute(
        'href',
        '/dashboards/d1/edit',
      );
    });

    it('says when a dashboard has no widgets', async () => {
      api.render.mockResolvedValue({ ...rendered, widgets: [] });
      renderAt('/dashboards/d1');
      expect(await screen.findByText('No widgets yet')).toBeInTheDocument();
    });

    describe('when a refetch fails', () => {
      const liveNumbers = async (client: QueryClient) => {
        api.render.mockResolvedValueOnce(rendered);
        renderAt('/dashboards/d1', client);
        expect(await screen.findByTestId('widget-count')).toHaveTextContent('4');
      };
      const refetch = async (client: QueryClient) => {
        await act(() =>
          client.invalidateQueries({ queryKey: ['dashboard-render', 'd1'] }).catch(() => {}),
        );
      };

      it.each([401, 403, 404])('on %i removes the numbers and the cache entry', async (status) => {
        const client = newClient();
        await liveNumbers(client);
        api.render.mockRejectedValue(failure(status, 'Dashboard not found'));
        await refetch(client);
        expect(await screen.findByText('Could not open this dashboard')).toBeInTheDocument();
        expect(screen.getByText('Dashboard not found')).toBeInTheDocument();
        expect(screen.queryByTestId('widget-count')).not.toBeInTheDocument();
        expect(screen.queryByText('Bugs')).not.toBeInTheDocument();
        await waitFor(() =>
          expect(client.getQueryData(['dashboard-render', 'd1'])).toBeUndefined(),
        );
      });

      it('does not ask again after being refused', async () => {
        const client = newClient();
        await liveNumbers(client);
        api.render.mockRejectedValue(failure(404, 'Dashboard not found'));
        await refetch(client);
        await screen.findByText('Could not open this dashboard');
        const calls = api.render.mock.calls.length;
        await refetch(client);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(api.render.mock.calls.length).toBe(calls);
      });

      it.each([
        ['429', failure(429, 'Too many')],
        ['500', failure(500, 'Broken')],
        ['a network error', new TypeError('Failed to fetch')],
      ])('on %s keeps what is on screen', async (_name, error) => {
        const client = newClient();
        await liveNumbers(client);
        api.render.mockRejectedValue(error);
        await refetch(client);
        expect(api.render.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(screen.getByTestId('widget-count')).toHaveTextContent('4');
        expect(screen.queryByText('Could not open this dashboard')).not.toBeInTheDocument();
      });
    });

    it('answers a dashboard it cannot open', async () => {
      api.render.mockRejectedValue(failure(404, 'Dashboard not found'));
      renderAt('/dashboards/d1');
      expect(await screen.findByText('Dashboard not found')).toBeInTheDocument();
    });
  });

  describe('DashboardEdit', () => {
    const row = (title: string) => screen.getByTestId(`widget-row-${title}`);

    it('lists the widgets with where each gets its data', async () => {
      renderAt('/dashboards/d1/edit');
      await screen.findByTestId('widget-row-Bugs');
      expect(within(row('Bugs')).getByText('type = BUG')).toBeInTheDocument();
      expect(await within(row('Saved')).findByText('Open bugs')).toBeInTheDocument();
    });

    it('moves a widget up and down, and not past the ends', async () => {
      api.reorderWidgets.mockResolvedValue(undefined);
      renderAt('/dashboards/d1/edit');
      await screen.findByTestId('widget-row-Bugs');
      expect(within(row('Bugs')).getByRole('button', { name: /Move up/ })).toBeDisabled();
      expect(within(row('Saved')).getByRole('button', { name: /Move down/ })).toBeDisabled();
      fireEvent.click(within(row('Bugs')).getByRole('button', { name: /Move down/ }));
      await waitFor(() =>
        expect(api.reorderWidgets).toHaveBeenCalledWith('d1', ['w2', 'w1', 'w3']),
      );
    });

    it('adds a widget with an inline query', async () => {
      api.addWidget.mockResolvedValue({ id: 'w4' });
      renderAt('/dashboards/d1/edit');
      await screen.findByTestId('widget-row-Bugs');
      fireEvent.click(screen.getByRole('button', { name: /Add widget/ }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'New one' } });
      fireEvent.change(within(dialog).getByLabelText('Query'), {
        target: { value: 'priority = HIGH' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: /Save widget/ }));
      await waitFor(() =>
        expect(api.addWidget).toHaveBeenCalledWith('d1', {
          type: 'COUNT',
          title: 'New one',
          query: 'priority = HIGH',
        }),
      );
    });

    it('shows why the server refused a widget, and keeps the form open', async () => {
      api.addWidget.mockRejectedValue(new Error('Unexpected end of query'));
      renderAt('/dashboards/d1/edit');
      await screen.findByTestId('widget-row-Bugs');
      fireEvent.click(screen.getByRole('button', { name: /Add widget/ }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Bad' } });
      fireEvent.change(within(dialog).getByLabelText('Query'), { target: { value: 'type =' } });
      fireEvent.click(within(dialog).getByRole('button', { name: /Save widget/ }));
      expect(await within(dialog).findByText('Unexpected end of query')).toBeInTheDocument();
    });

    it('edits a widget, swapping its source', async () => {
      api.updateWidget.mockResolvedValue({ id: 'w3' });
      renderAt('/dashboards/d1/edit');
      await screen.findByTestId('widget-row-Saved');
      fireEvent.click(within(row('Saved')).getByRole('button', { name: /Edit widget/ }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: /Inline query/ }));
      fireEvent.change(within(dialog).getByLabelText('Query'), { target: { value: 'type = BUG' } });
      fireEvent.click(within(dialog).getByRole('button', { name: /Save widget/ }));
      await waitFor(() =>
        expect(api.updateWidget).toHaveBeenCalledWith('d1', 'w3', {
          type: 'LIST',
          title: 'Saved',
          query: 'type = BUG',
          savedQueryId: null,
        }),
      );
    });

    it('offers only saved queries written as text', async () => {
      renderAt('/dashboards/d1/edit');
      await screen.findByTestId('widget-row-Bugs');
      fireEvent.click(screen.getByRole('button', { name: /Add widget/ }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: /Saved query/ }));
      const picker = await within(dialog).findByTestId('saved-query-picker');
      fireEvent.click(within(picker).getByRole('button'));
      expect(await within(picker).findByText('Open bugs')).toBeInTheDocument();
      expect(within(picker).queryByText('Issue list preset')).not.toBeInTheDocument();
    });

    it('asks no query for a sprint overview', async () => {
      api.addWidget.mockResolvedValue({ id: 'w4' });
      renderAt('/dashboards/d1/edit');
      await screen.findByTestId('widget-row-Bugs');
      fireEvent.click(within(row('Sprints')).getByRole('button', { name: /Edit widget/ }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).queryByLabelText('Query')).not.toBeInTheDocument();
    });

    it('removes a widget after asking', async () => {
      api.removeWidget.mockResolvedValue(undefined);
      renderAt('/dashboards/d1/edit');
      await screen.findByTestId('widget-row-Bugs');
      fireEvent.click(within(row('Bugs')).getByRole('button', { name: /Remove widget/ }));
      const dialog = await screen.findByRole('dialog');
      expect(api.removeWidget).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole('button', { name: /Remove/ }));
      await waitFor(() => expect(api.removeWidget).toHaveBeenCalledWith('d1', 'w1'));
    });

    it('hides the form when a refetch is refused', async () => {
      const client = newClient();
      renderAt('/dashboards/d1/edit', client);
      await screen.findByTestId('widget-row-Bugs');
      api.get.mockRejectedValue(failure(404, 'Dashboard not found'));
      await act(() => client.invalidateQueries({ queryKey: ['dashboards', 'd1'] }).catch(() => {}));
      expect(await screen.findByText('Could not open this dashboard')).toBeInTheDocument();
      expect(screen.queryByTestId('widget-row-Bugs')).not.toBeInTheDocument();
    });

    describe('saving an inline query', () => {
      const openWithQuery = async () => {
        renderAt('/dashboards/d1/edit');
        await screen.findByTestId('widget-row-Bugs');
        fireEvent.click(screen.getByRole('button', { name: /Add widget/ }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'New' } });
        fireEvent.change(within(dialog).getByLabelText('Query'), {
          target: { value: 'type = BUG' },
        });
        return dialog;
      };

      it('offers it only once there is a query', async () => {
        renderAt('/dashboards/d1/edit');
        await screen.findByTestId('widget-row-Bugs');
        fireEvent.click(screen.getByRole('button', { name: /Add widget/ }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('button', { name: /Save as query/ })).toBeDisabled();
      });

      it('saves it privately by default and makes the widget use it', async () => {
        savedApi.createQuery.mockResolvedValue({ id: 'q9', name: 'High bugs' });
        api.addWidget.mockResolvedValue({ id: 'w4' });
        const dialog = await openWithQuery();
        fireEvent.click(within(dialog).getByRole('button', { name: /Save as query/ }));
        const save = within(dialog).getByRole('button', { name: /Save query/ });
        expect(save).toBeDisabled();
        fireEvent.change(within(dialog).getByLabelText('Query name'), {
          target: { value: 'High bugs' },
        });
        fireEvent.click(save);
        await waitFor(() =>
          expect(savedApi.createQuery).toHaveBeenCalledWith({
            name: 'High bugs',
            text: 'type = BUG',
            visibility: 'PRIVATE',
          }),
        );
        await within(dialog).findByTestId('saved-query-picker');
        fireEvent.click(within(dialog).getByRole('button', { name: /Save widget/ }));
        await waitFor(() =>
          expect(api.addWidget).toHaveBeenCalledWith('d1', {
            type: 'COUNT',
            title: 'New',
            savedQueryId: 'q9',
          }),
        );
      });

      it('shares it with the team chosen', async () => {
        savedApi.createQuery.mockResolvedValue({ id: 'q9', name: 'Shared' });
        const dialog = await openWithQuery();
        fireEvent.click(within(dialog).getByRole('button', { name: /Save as query/ }));
        fireEvent.change(within(dialog).getByLabelText('Query name'), {
          target: { value: 'Shared' },
        });
        fireEvent.click(within(dialog).getByLabelText('Shared with'));
        fireEvent.click(await within(dialog).findByText('A team'));
        const save = within(dialog).getByRole('button', { name: /Save query/ });
        // Not until a team is chosen
        expect(save).toBeDisabled();
        fireEvent.click(within(dialog).getByLabelText('Team'));
        fireEvent.click(await within(dialog).findByText('Example Org / Core'));
        fireEvent.click(save);
        await waitFor(() =>
          expect(savedApi.createQuery).toHaveBeenCalledWith({
            name: 'Shared',
            text: 'type = BUG',
            visibility: 'TEAM',
            teamId: 't1',
          }),
        );
      });

      it('says why the server refused it and keeps the query', async () => {
        savedApi.createQuery.mockRejectedValue(new Error('Unexpected end of query'));
        const dialog = await openWithQuery();
        fireEvent.click(within(dialog).getByRole('button', { name: /Save as query/ }));
        fireEvent.change(within(dialog).getByLabelText('Query name'), {
          target: { value: 'Bad' },
        });
        fireEvent.click(within(dialog).getByRole('button', { name: /Save query/ }));
        expect(await within(dialog).findByText('Unexpected end of query')).toBeInTheDocument();
        expect(within(dialog).getByLabelText('Query')).toHaveValue('type = BUG');
      });
    });

    it('saves the settings', async () => {
      api.update.mockResolvedValue(dashboard);
      renderAt('/dashboards/d1/edit');
      const name = await screen.findByLabelText('Name');
      await waitFor(() => expect(name).toHaveValue('Team health'));
      fireEvent.change(name, { target: { value: 'Renamed' } });
      fireEvent.click(screen.getByRole('button', { name: /Save settings/ }));
      await waitFor(() =>
        expect(api.update).toHaveBeenCalledWith(
          'd1',
          expect.objectContaining({ name: 'Renamed', layout: { columns: 2 } }),
        ),
      );
    });

    it('tells who may not edit that they cannot', async () => {
      api.get.mockResolvedValue({ ...dashboard, canEdit: false, widgets });
      renderAt('/dashboards/d1/edit');
      expect(await screen.findByText(/cannot change this dashboard/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Add widget/ })).not.toBeInTheDocument();
    });
  });
});
