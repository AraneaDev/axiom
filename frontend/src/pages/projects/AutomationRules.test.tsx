import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listRules: vi.fn(),
  createRule: vi.fn(),
  updateRule: vi.fn(),
  deleteRule: vi.fn(),
  toggleRule: vi.fn(),
}));

vi.mock('@/api/workflows.api', () => ({ automationApi: api }));
vi.mock('@/hooks/useProjectContext', () => ({
  useProjectContext: () => ({ currentProject: { id: 'p1', name: 'Widget board', prefix: 'WGT' } }),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import AutomationRules from './AutomationRules';

const defaultRule = {
  id: 'r1',
  projectId: 'p1',
  name: 'GitHub: PR opened moves to In review',
  trigger: 'pr:opened',
  condition: 'done = false',
  conditions: null,
  actions: [{ type: 'set_status', columnId: 'c1' }],
  enabled: true,
  createdAt: '2026-11-01T10:00:00Z',
};

function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AutomationRules />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listRules.mockResolvedValue([defaultRule]);
  api.updateRule.mockResolvedValue(defaultRule);
});

describe('AutomationRules query condition', () => {
  it('shows the condition of a default rule on its card', async () => {
    show();
    expect(await screen.findByText(/Condition: done = false/)).toBeInTheDocument();
  });

  it('shows it in the edit form instead of "No conditions", and saves it unchanged', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Edit/ }));

    expect(screen.getByLabelText(/Query condition/)).toHaveValue('done = false');
    expect(screen.queryByText(/No conditions/)).not.toBeInTheDocument();
    expect(screen.getByText(/used instead of the conditions list/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Save Rule/ }));
    await waitFor(() => expect(api.updateRule).toHaveBeenCalled());
    expect(api.updateRule.mock.calls[0][2]).toMatchObject({ condition: 'done = false' });
  });

  it('saves a changed condition and clears it when emptied', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Edit/ }));
    const field = screen.getByLabelText(/Query condition/);
    await user.clear(field);
    await user.type(field, 'type = Bug');
    await user.click(screen.getByRole('button', { name: /Save Rule/ }));
    await waitFor(() => expect(api.updateRule).toHaveBeenCalledTimes(1));
    expect(api.updateRule.mock.calls[0][2]).toMatchObject({ condition: 'type = Bug' });
  });
});
