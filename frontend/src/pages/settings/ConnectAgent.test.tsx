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
    const lines = (block as HTMLTextAreaElement).value.split('\n');
    expect(lines[0]).toBe('[mcp_servers.axiom]');
    expect(lines.some((l) => l.startsWith('url = '))).toBe(true);
    expect(lines.some((l) => l.startsWith('http_headers = '))).toBe(true);
  });

  it('names the token Agent for a client that is not listed, not Other', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: /other/i }));
    expect(screen.getByLabelText('Token name')).toHaveValue('Agent');
  });

  it('shows an error, not an empty command, when the answer holds no token', async () => {
    createApiToken.mockResolvedValue({ id: '1', name: 'Claude Code' });
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: /create token/i }));
    expect(await screen.findByText(/did not return a token/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('~/.codex/config.toml')).not.toBeInTheDocument();
    expect(screen.queryByText(/claude mcp add/i)).not.toBeInTheDocument();
  });

  it.each([
    [1, 'You have 1 API token.'],
    [3, 'You have 3 API tokens.'],
  ])('says "%s API token" in the singular or the plural', async (count, text) => {
    listApiTokens.mockResolvedValue(Array.from({ length: count }, (_, i) => ({ id: `${i}` })));
    show();
    expect(await screen.findByText(text, { exact: false })).toBeInTheDocument();
  });
});
