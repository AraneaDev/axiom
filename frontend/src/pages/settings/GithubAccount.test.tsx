import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const account = vi.hoisted(() => ({
  get: vi.fn(),
  startConnect: vi.fn(),
  completeConnect: vi.fn(),
  disconnect: vi.fn(),
}));
const app = vi.hoisted(() => ({ status: vi.fn() }));

vi.mock('@/api/github.api', () => ({ githubAccountApi: account, githubAppApi: app }));

import GithubAccount, { GithubAccountCallback } from './GithubAccount';

function show(path: string) {
  render(
    <StrictMode>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/settings/github" element={<GithubAccount />} />
            <Route path="/settings/github/callback" element={<GithubAccountCallback />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

describe('GithubAccount', () => {
  beforeEach(() => {
    Object.values(account).forEach((m) => m.mockReset());
    app.status.mockReset();
    app.status.mockResolvedValue({ configured: true, installations: [] });
  });

  it('says so when an administrator has not set up GitHub', async () => {
    app.status.mockResolvedValue({ configured: false, installations: [] });
    account.get.mockResolvedValue({ connected: false });
    show('/settings/github');
    expect(
      await screen.findByText('An administrator has not set up GitHub yet'),
    ).toBeInTheDocument();
  });

  it('connects: asks for the authorize URL and goes there', async () => {
    account.get.mockResolvedValue({ connected: false });
    account.startConnect.mockResolvedValue({ authorizeUrl: 'https://github.com/login/oauth/x' });
    const go = vi.fn();
    const user = userEvent.setup();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign: go },
    });
    show('/settings/github');
    await user.click(await screen.findByRole('button', { name: /connect github/i }));
    await waitFor(() => expect(go).toHaveBeenCalledWith('https://github.com/login/oauth/x'));
  });

  it('shows the login and disconnects after confirming', async () => {
    account.get.mockResolvedValue({ connected: true, login: 'octo-tim' });
    account.disconnect.mockResolvedValue({ connected: false });
    const user = userEvent.setup();
    show('/settings/github');
    expect(await screen.findByText('octo-tim')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /disconnect/i }));
    expect(account.disconnect).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole('button', { name: /^disconnect$/i });
    await user.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(account.disconnect).toHaveBeenCalledTimes(1));
  });

  it('completes the connection once under StrictMode and returns to the page', async () => {
    account.completeConnect.mockResolvedValue({ connected: true, login: 'octo-tim' });
    account.get.mockResolvedValue({ connected: true, login: 'octo-tim' });
    show('/settings/github/callback?code=c_1&state=s1');
    expect(await screen.findByText('octo-tim')).toBeInTheDocument();
    expect(account.completeConnect).toHaveBeenCalledTimes(1);
    expect(account.completeConnect).toHaveBeenCalledWith('c_1', 's1');
  });

  it('shows the message of a failed callback', async () => {
    account.completeConnect.mockRejectedValue(
      new Error('That GitHub account is already connected to another user'),
    );
    show('/settings/github/callback?code=c_1&state=s1');
    expect(await screen.findByText(/already connected to another user/)).toBeInTheDocument();
  });
});
