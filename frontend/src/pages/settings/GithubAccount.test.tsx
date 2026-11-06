import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const account = vi.hoisted(() => ({
  get: vi.fn(),
  startConnect: vi.fn(),
  completeConnect: vi.fn(),
  disconnect: vi.fn(),
}));
const app = vi.hoisted(() => ({ status: vi.fn() }));

vi.mock('@/api/github.api', () => ({
  GITHUB_APP_KEY: ['github-app'],
  GITHUB_ACCOUNT_KEY: ['github-account'],
  githubAccountApi: account,
  githubAppApi: app,
}));

import GithubAccount, { GithubAccountCallback } from './GithubAccount';

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

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
          <Where />
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

const realLocation = Object.getOwnPropertyDescriptor(window, 'location')!;

describe('GithubAccount', () => {
  afterEach(() => Object.defineProperty(window, 'location', realLocation));

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

  it('takes the code out of the URL before the request, and after a failure', async () => {
    let seenAtRequest = '';
    account.completeConnect.mockImplementation(async () => {
      seenAtRequest = screen.getByTestId('where').textContent ?? '';
      throw new Error('bad state');
    });
    show('/settings/github/callback?code=c_1&state=s1');
    await screen.findByText('bad state');
    expect(seenAtRequest).toBe('/settings/github/callback');
    expect(screen.getByTestId('where').textContent).toBe('/settings/github/callback');
  });

  it('goes back to the page when reached without a code', async () => {
    account.get.mockResolvedValue({ connected: false });
    show('/settings/github/callback');
    await screen.findByRole('button', { name: /connect github/i });
    expect(account.completeConnect).not.toHaveBeenCalled();
    expect(screen.getByTestId('where').textContent).toBe('/settings/github');
  });

  it('uses the shared settings layout with its help column', async () => {
    account.get.mockResolvedValue({ connected: false });
    show('/settings/github');
    expect(await screen.findByText('What connecting does')).toBeInTheDocument();
  });
});
