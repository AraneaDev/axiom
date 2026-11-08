import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  get: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
  reconcile: vi.fn(),
  health: vi.fn(),
}));
const account = vi.hoisted(() => ({ get: vi.fn() }));
const app = vi.hoisted(() => ({ status: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/api/github.api', () => ({
  GITHUB_APP_KEY: ['github-app'],
  GITHUB_ACCOUNT_KEY: ['github-account'],
  githubRepoKey: (id: string) => ['github-repo', id],
  githubHealthKey: (id: string) => ['github-health', id],
  githubRepoApi: repo,
  githubAccountApi: account,
  githubAppApi: app,
}));
vi.mock('@/hooks/useProjectContext', () => ({
  useProjectContext: () => ({
    currentProject: { id: 'p1', name: 'Widget board', prefix: 'WGT' },
    org: 'acme',
    teamSlug: 'core',
    projectSlug: 'widget',
  }),
}));
vi.mock('./GithubImportSection', () => ({ GithubImportSection: () => null }));
vi.mock('./ReleaseNotesSection', () => ({ ReleaseNotesSection: () => null }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => toast }));

import GithubSettings from './GithubSettings';

function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <GithubSettings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const linked = {
  id: 'l1',
  projectId: 'p1',
  repoFullName: 'acme-labs/widget',
  owner: 'acme-labs',
  name: 'widget',
  htmlUrl: 'https://github.com/acme-labs/widget',
  defaultBranch: 'main',
  linkedBy: { id: 'u1', username: 'mira', displayName: 'Mira Dev' },
  createdAt: '2026-11-01T10:00:00Z',
  linkedIssueCount: 3,
};
const health = {
  linked: true,
  repoFullName: 'acme-labs/widget',
  appInstalled: true,
  installationRemoved: false,
  installationSuspended: false,
  appSecretUnreadable: false,
  reconcileComplete: true,
  reconcileIncompleteReason: null,
  lastDeliveryAt: '2026-11-05T10:00:00Z',
  lastReconciledAt: '2026-11-05T11:00:00Z',
  lastReconcileError: null,
  recentFailures: [],
};

class WithDetails extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

describe('GithubSettings', () => {
  beforeEach(() => {
    Object.values(repo).forEach((m) => m.mockReset());
    account.get.mockReset();
    app.status.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    repo.get.mockResolvedValue(null);
    repo.health.mockResolvedValue({ ...health, linked: false });
    account.get.mockResolvedValue({ connected: true, login: 'mira' });
    app.status.mockResolvedValue({
      configured: true,
      installUrl: 'https://github.com/apps/axiom-x/installations/new',
      installations: [{ id: 1, accountLogin: 'acme-labs', suspended: false }],
    });
  });

  describe('not linked', () => {
    it('links the repository you type', async () => {
      repo.link.mockResolvedValue(linked);
      show();
      await userEvent.type(await screen.findByLabelText('Repository'), 'acme-labs/widget');
      await userEvent.click(screen.getByRole('button', { name: 'Link repository' }));
      await waitFor(() => expect(repo.link).toHaveBeenCalledWith('p1', 'acme-labs/widget'));
    });

    it('sends you to your GitHub settings when no account is connected', async () => {
      account.get.mockResolvedValue({ connected: false });
      show();
      const link = await screen.findByRole('link', { name: /connect your github account/i });
      expect(link).toHaveAttribute('href', '/settings/github');
      expect(screen.getByRole('button', { name: 'Link repository' })).toBeDisabled();
    });

    it('offers the install link when the App is installed nowhere', async () => {
      app.status.mockResolvedValue({
        configured: true,
        installUrl: 'https://github.com/apps/axiom-x/installations/new',
        installations: [],
      });
      show();
      const link = await screen.findByRole('link', { name: /install the github app/i });
      expect(link).toHaveAttribute('href', 'https://github.com/apps/axiom-x/installations/new');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('says so when no GitHub App is set up', async () => {
      app.status.mockResolvedValue({ configured: false, installations: [] });
      show();
      expect(await screen.findByText(/has not set up github/i)).toBeInTheDocument();
    });

    it('shows a refusal by its message, with the install link from its details', async () => {
      repo.link.mockRejectedValue(
        new WithDetails(
          'The GitHub App is not installed on acme-labs/widget',
          'GITHUB_APP_NOT_INSTALLED',
          {
            installUrl: 'https://github.com/apps/axiom-x/installations/new',
          },
        ),
      );
      show();
      await userEvent.type(await screen.findByLabelText('Repository'), 'acme-labs/widget');
      await userEvent.click(screen.getByRole('button', { name: 'Link repository' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('The GitHub App is not installed');
      expect(screen.getByRole('link', { name: /install the github app/i })).toHaveAttribute(
        'href',
        'https://github.com/apps/axiom-x/installations/new',
      );
    });

    it('shows a plain refusal by its message', async () => {
      repo.link.mockRejectedValue(
        new WithDetails('You need admin rights on that repository', 'GITHUB_NOT_REPO_ADMIN'),
      );
      show();
      await userEvent.type(await screen.findByLabelText('Repository'), 'acme-labs/widget');
      await userEvent.click(screen.getByRole('button', { name: 'Link repository' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('admin rights');
    });
  });

  describe('linked', () => {
    beforeEach(() => {
      repo.get.mockResolvedValue(linked);
      repo.health.mockResolvedValue(health);
    });

    it('shows the repository, its health and no failures', async () => {
      show();
      expect(await screen.findByRole('link', { name: /acme-labs\/widget/ })).toHaveAttribute(
        'href',
        'https://github.com/acme-labs/widget',
      );
      expect(screen.getByText(/last delivery/i)).toBeInTheDocument();
      expect(screen.getByText(/last reconcile/i)).toBeInTheDocument();
      expect(screen.getByText(/no failed deliveries/i)).toBeInTheDocument();
    });

    it('lists failed deliveries in a table and the last reconcile error', async () => {
      repo.health.mockResolvedValue({
        ...health,
        lastReconcileError: 'GitHub answered 502',
        recentFailures: [
          {
            deliveryId: 'd1',
            event: 'pull_request',
            action: 'opened',
            error: 'boom',
            attempts: 3,
            receivedAt: '2026-11-05T09:00:00Z',
          },
        ],
      });
      show();
      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(screen.getByText('pull_request')).toBeInTheDocument();
      expect(screen.getByText('boom')).toBeInTheDocument();
      expect(screen.getByText('GitHub answered 502')).toBeInTheDocument();
    });

    it('warns about a suspended installation and an unreadable App secret', async () => {
      repo.health.mockResolvedValue({
        ...health,
        installationSuspended: true,
        appSecretUnreadable: true,
      });
      show();
      expect(await screen.findByText(/suspended/i)).toBeInTheDocument();
      expect(screen.getByText(/secret .* cannot be read/i)).toBeInTheDocument();
    });

    it('says one issue in the singular and quotes a name safely', async () => {
      repo.get.mockResolvedValue({ ...linked, linkedIssueCount: 1 });
      show();
      await userEvent.click(await screen.findByRole('button', { name: 'Unlink' }));
      expect(screen.getByText(/disappear from 1 issue$/)).toBeInTheDocument();
    });

    it('says a repository that was removed is not installed any more, not suspended', async () => {
      repo.health.mockResolvedValue({
        ...health,
        appInstalled: false,
        installationRemoved: true,
        installationSuspended: false,
      });
      show();
      expect(await screen.findByText(/no longer installed/i)).toBeInTheDocument();
      expect(screen.queryByText(/is suspended/i)).toBeNull();
    });

    it('says when the App was never seen on this installation', async () => {
      repo.health.mockResolvedValue({ ...health, appInstalled: false });
      show();
      expect(await screen.findByText(/not installed/i)).toBeInTheDocument();
    });

    it('shows an incomplete reconcile with its reason', async () => {
      repo.health.mockResolvedValue({
        ...health,
        reconcileComplete: false,
        reconcileIncompleteReason: 'Only the first 500 pull requests were read',
      });
      show();
      expect(await screen.findByText(/reconcile is incomplete/i)).toBeInTheDocument();
      expect(screen.getByText(/first 500 pull requests/)).toBeInTheDocument();
    });

    it('shows the cooldown with its retry time', async () => {
      repo.reconcile.mockRejectedValue(
        new WithDetails(
          'This repository was reconciled a moment ago.',
          'GITHUB_RECONCILE_COOLDOWN',
          {
            retryAfter: 42,
          },
        ),
      );
      show();
      await userEvent.click(await screen.findByRole('button', { name: 'Reconcile now' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('reconciled a moment ago');
      expect(alert).toHaveTextContent('42 seconds');
      // The server's message and the retry time together say it once
      expect(alert.textContent?.match(/try again/gi)).toHaveLength(1);
    });

    it('says the reconcile started and reads the health again a moment later', async () => {
      repo.reconcile.mockResolvedValue({ started: true });
      show();
      await screen.findByRole('button', { name: 'Reconcile now' });
      const callsBefore = repo.health.mock.calls.length;
      await userEvent.click(screen.getByRole('button', { name: 'Reconcile now' }));
      await waitFor(() => expect(repo.reconcile).toHaveBeenCalledWith('p1'));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Reconcile started'));
      await waitFor(() => expect(repo.health.mock.calls.length).toBeGreaterThan(callsBefore), {
        timeout: 5000,
      });
    }, 10_000);

    it('shows a running reconcile by its message', async () => {
      repo.reconcile.mockRejectedValue(
        new WithDetails('A reconcile is already running', 'GITHUB_RECONCILE_RUNNING'),
      );
      show();
      await userEvent.click(await screen.findByRole('button', { name: 'Reconcile now' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('already running');
    });

    it('unlinks after you confirm, with the effect quoted', async () => {
      repo.unlink.mockResolvedValue({ unlinked: true });
      show();
      await userEvent.click(await screen.findByRole('button', { name: 'Unlink' }));
      expect(
        screen.getByText(
          'Unlink acme-labs/widget from project WGT "Widget board": its branches, pull requests and checks disappear from 3 issues',
        ),
      ).toBeInTheDocument();
      expect(repo.unlink).not.toHaveBeenCalled();
      const dialog = screen.getByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Unlink' }));
      await waitFor(() => expect(repo.unlink).toHaveBeenCalledWith('p1'));
    });
  });
});
