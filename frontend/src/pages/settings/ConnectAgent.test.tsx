import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createApiToken = vi.hoisted(() => vi.fn());
const listApiTokens = vi.hoisted(() => vi.fn());

vi.mock('@/api/users.api', () => ({ usersApi: { createApiToken, listApiTokens } }));

import { ToastProvider } from '@/components/ui/Toast';

import ConnectAgent from './ConnectAgent';

function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <MemoryRouter>
          <ConnectAgent />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('ConnectAgent', () => {
  beforeEach(() => {
    createApiToken.mockReset();
    listApiTokens.mockReset();
    listApiTokens.mockResolvedValue([]);
    createApiToken.mockResolvedValue({ id: '1', name: 'Codex', token: 'tk_secret' });
  });

  it('creates a 90 day token without admin and shows the Codex config', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: /codex/i }));
    expect(screen.getByLabelText('Token name')).toHaveValue('Codex');
    await user.click(screen.getByRole('button', { name: /create token/i }));
    await waitFor(() => expect(createApiToken).toHaveBeenCalled());
    const body = createApiToken.mock.calls[0][0];
    expect(body.name).toBe('Codex');
    expect(body.expiresInDays).toBe(90);
    expect(body.scopes).toContain('issues:write');
    expect(body.scopes).toContain('search:read');
    expect(body.scopes.some((s: string) => s.startsWith('admin'))).toBe(false);
    const block = await screen.findByLabelText('~/.codex/config.toml');
    expect((block as HTMLInputElement).value).toContain('http_headers');
    expect((block as HTMLInputElement).value).toContain('Token tk_secret');
  });
});
