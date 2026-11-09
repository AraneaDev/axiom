import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/components/ui/Toast';

import UserManagement from './UserManagement';

const user = (over: object) => ({
  id: 'u1',
  email: 'sarah@example.test',
  username: 'sarah',
  displayName: 'Sarah Chen',
  twoFactorEnabled: false,
  createdAt: '2026-11-05T10:00:00.000Z',
  deactivatedAt: null,
  kind: 'PERSON',
  orgMemberships: [],
  ...over,
});

vi.mock('@/api/admin.api', () => ({
  adminApi: {
    listUsers: async () => ({
      users: [
        user({}),
        user({
          id: 'github-integration',
          email: 'github-integration@users.invalid',
          username: 'github-integration',
          displayName: 'GitHub',
          kind: 'INTEGRATION',
        }),
        user({
          id: 'bot-1',
          email: 'bot-1@service-accounts.invalid',
          username: 'nightly-triage',
          displayName: 'Nightly Triage',
          kind: 'SERVICE',
          orgMemberships: [
            { role: 'MEMBER', org: { id: 'org-1', name: 'Acme Labs', slug: 'acme-labs' } },
          ],
        }),
      ],
      total: 3,
    }),
  },
}));

function rowOf(name: string) {
  return screen.getByText(name).closest('tr') as HTMLElement;
}

describe('UserManagement', () => {
  it('shows the built-in GitHub user read-only', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ToastProvider>
            <UserManagement />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('GitHub');
    const person = within(rowOf('Sarah Chen'));
    expect(person.getByTitle('Delete user')).toBeTruthy();
    expect(person.getByTitle('Reset password')).toBeTruthy();

    const builtIn = within(rowOf('GitHub'));
    expect(builtIn.getByText('Built in')).toBeTruthy();
    expect(builtIn.getByTitle('View user details')).toBeTruthy();
    expect(builtIn.queryByTitle('Delete user')).toBeNull();
    expect(builtIn.queryByTitle('Reset password')).toBeNull();
    expect(builtIn.queryByTitle('Deactivate user')).toBeNull();
  });

  it('offers no deactivate or password reset for a bot, and links to its page instead', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ToastProvider>
            <UserManagement />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Nightly Triage');
    const bot = within(rowOf('Nightly Triage'));
    expect(bot.getByText('bot')).toBeTruthy();
    expect(bot.queryByTitle('Deactivate user')).toBeNull();
    expect(bot.queryByTitle('Reactivate user')).toBeNull();
    expect(bot.queryByTitle('Reset password')).toBeNull();
    expect(bot.getByTitle('Open the service account')).toHaveAttribute(
      'href',
      '/acme-labs/settings/service-accounts/bot-1',
    );
  });
});
