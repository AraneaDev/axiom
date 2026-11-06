import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  status: vi.fn(),
  startManifest: vi.fn(),
  completeManifest: vi.fn(),
  syncInstallations: vi.fn(),
  remove: vi.fn(),
}));
const auth = vi.hoisted(() => ({ user: { isAdmin: true } as { isAdmin: boolean } | null }));

vi.mock('@/api/github.api', () => ({ GITHUB_APP_KEY: ['github-app'], githubAppApi: api }));
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (select: (s: { user: typeof auth.user }) => unknown) => select({ user: auth.user }),
}));

import GithubAppSettings, { GithubAppCreated, GithubAppInstalled } from './GithubAppSettings';

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
            <Route path="/admin/github" element={<GithubAppSettings />} />
            <Route path="/admin/github/created" element={<GithubAppCreated />} />
            <Route path="/admin/github/installed" element={<GithubAppInstalled />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

const configured = {
  configured: true,
  slug: 'axiom-test',
  htmlUrl: 'https://github.com/apps/axiom-test',
  installUrl: 'https://github.com/apps/axiom-test/installations/new',
  installations: [
    { id: 1, accountLogin: 'acme-co', suspended: false },
    { id: 2, accountLogin: 'old-org', suspended: true },
  ],
};

describe('GithubAppSettings', () => {
  beforeEach(() => {
    Object.values(api).forEach((m) => m.mockReset());
    auth.user = { isAdmin: true };
  });

  it('is for platform admins only', () => {
    auth.user = { isAdmin: false };
    api.status.mockResolvedValue({ configured: false, installations: [] });
    show('/admin/github');
    expect(screen.getByText(/only platform administrators/i)).toBeInTheDocument();
  });

  it('offers to create the App when none is set up, and posts the manifest as a form', async () => {
    api.status.mockResolvedValue({ configured: false, installations: [] });
    api.startManifest.mockResolvedValue({
      postUrl: 'https://github.com/settings/apps/new?state=abc',
      manifest: { name: 'Axiom' },
      state: 'abc',
    });
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    const user = userEvent.setup();
    show('/admin/github');
    await user.type(await screen.findByLabelText(/organization/i), 'acme-co');
    await user.click(screen.getByRole('button', { name: /create github app/i }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(api.startManifest).toHaveBeenCalledWith('acme-co');
    const form = submit.mock.instances[0] as unknown as HTMLFormElement;
    expect(form.method).toBe('post');
    expect(form.action).toBe('https://github.com/settings/apps/new?state=abc');
    const input = form.elements.namedItem('manifest') as HTMLInputElement;
    expect(input.type).toBe('hidden');
    expect(JSON.parse(input.value)).toEqual({ name: 'Axiom' });
    submit.mockRestore();
  });

  it('shows the App, its installations and the refresh and forget buttons', async () => {
    api.status.mockResolvedValue(configured);
    const user = userEvent.setup();
    show('/admin/github');
    expect(await screen.findByText('axiom-test')).toBeInTheDocument();
    expect(screen.getByText('acme-co')).toBeInTheDocument();
    expect(screen.getByText('Suspended')).toBeInTheDocument();
    api.syncInstallations.mockResolvedValue(configured);
    await user.click(screen.getByRole('button', { name: /refresh installations/i }));
    await waitFor(() => expect(api.syncInstallations).toHaveBeenCalledTimes(1));
  });

  it('forgets the App only after confirming', async () => {
    api.status.mockResolvedValue(configured);
    api.remove.mockResolvedValue({ deleted: true, note: '' });
    const user = userEvent.setup();
    show('/admin/github');
    await user.click(await screen.findByRole('button', { name: /forget app/i }));
    expect(api.remove).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole('button', { name: /^forget app$/i });
    await user.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(api.remove).toHaveBeenCalledTimes(1));
  });

  it('shows the error of a failed start', async () => {
    api.status.mockResolvedValue({ configured: false, installations: [] });
    api.startManifest.mockRejectedValue(new Error('A GitHub App is already set up here.'));
    const user = userEvent.setup();
    show('/admin/github');
    await user.click(await screen.findByRole('button', { name: /create github app/i }));
    expect(await screen.findByText(/already set up here/)).toBeInTheDocument();
  });

  it('completes the manifest once under StrictMode and shows the install link', async () => {
    api.completeManifest.mockResolvedValue(configured);
    show('/admin/github/created?code=abc_1&state=st1');
    const link = await screen.findByRole('link', { name: /install on github/i });
    expect(link).toHaveAttribute('href', configured.installUrl);
    expect(api.completeManifest).toHaveBeenCalledTimes(1);
    expect(api.completeManifest).toHaveBeenCalledWith('abc_1', 'st1');
  });

  it('shows the message when the state is bad or expired', async () => {
    api.completeManifest.mockRejectedValue(new Error('This setup link has expired'));
    show('/admin/github/created?code=abc_1&state=old');
    expect(await screen.findByText(/setup link has expired/)).toBeInTheDocument();
  });

  it('syncs installations once on /installed and returns to the page', async () => {
    api.syncInstallations.mockResolvedValue(configured);
    api.status.mockResolvedValue(configured);
    show('/admin/github/installed?installation_id=7&setup_action=install');
    expect(await screen.findByText('axiom-test')).toBeInTheDocument();
    expect(api.syncInstallations).toHaveBeenCalledTimes(1);
  });

  it('takes the code out of the URL before the request goes out', async () => {
    let seenAtRequest = '';
    api.completeManifest.mockImplementation(async () => {
      seenAtRequest = screen.getByTestId('where').textContent ?? '';
      return configured;
    });
    show('/admin/github/created?code=abc_1&state=st1');
    await screen.findByRole('link', { name: /install on github/i });
    expect(seenAtRequest).toBe('/admin/github/created');
    expect(screen.getByTestId('where').textContent).not.toMatch(/code=/);
  });

  it('takes the code out of the URL when the call fails', async () => {
    api.completeManifest.mockRejectedValue(new Error('This setup link has expired'));
    show('/admin/github/created?code=abc_1&state=old');
    await screen.findByText(/setup link has expired/);
    expect(screen.getByTestId('where').textContent).toBe('/admin/github/created');
  });

  it('goes back to the page when reached without a code', async () => {
    api.status.mockResolvedValue(configured);
    show('/admin/github/created');
    expect(await screen.findByText('axiom-test')).toBeInTheDocument();
    expect(api.completeManifest).not.toHaveBeenCalled();
    expect(screen.getByTestId('where').textContent).toBe('/admin/github');
  });

  it('closes the dialog and shows the error when forgetting fails', async () => {
    api.status.mockResolvedValue(configured);
    api.remove.mockRejectedValue(new Error('GitHub is unreachable'));
    const user = userEvent.setup();
    show('/admin/github');
    await user.click(await screen.findByRole('button', { name: /forget app/i }));
    const buttons = screen.getAllByRole('button', { name: /^forget app$/i });
    await user.click(buttons[buttons.length - 1]);
    expect(await screen.findByText('GitHub is unreachable')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names the icon-only back button', async () => {
    api.status.mockResolvedValue(configured);
    show('/admin/github');
    expect(await screen.findByRole('button', { name: 'Back to admin' })).toBeInTheDocument();
  });
});
