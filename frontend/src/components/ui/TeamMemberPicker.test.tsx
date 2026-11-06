import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/api/teams.api', () => ({ teamsApi: api }));

import { TeamMemberPicker } from './TeamMemberPicker';

const member = (id: string, displayName: string, username: string) => ({
  id: `m-${id}`,
  userId: id,
  role: 'MEMBER',
  user: { id, username, displayName },
});

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({
    id: 't1',
    members: [member('u1', 'Mira Veld', 'mira'), member('u2', 'Joris Bakker', 'joris')],
  });
});

function renderPicker(onChange = vi.fn(), value = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TeamMemberPicker teamId="t1" value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

describe('TeamMemberPicker', () => {
  it('searches the members of the team by name', async () => {
    renderPicker();
    expect(await screen.findByText('Mira Veld')).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(/search members/i), 'jor');
    expect(screen.queryByText('Mira Veld')).not.toBeInTheDocument();
    expect(screen.getByText('Joris Bakker')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('t1');
  });

  it('reports the id of the chosen member', async () => {
    const onChange = renderPicker();
    await userEvent.click(await screen.findByRole('button', { name: /joris bakker/i }));
    expect(onChange).toHaveBeenCalledWith('u2');
  });

  it('says so when nobody matches', async () => {
    renderPicker();
    await screen.findByText('Mira Veld');
    await userEvent.type(screen.getByPlaceholderText(/search members/i), 'zzz');
    expect(screen.getByText('No members found')).toBeInTheDocument();
  });
});
