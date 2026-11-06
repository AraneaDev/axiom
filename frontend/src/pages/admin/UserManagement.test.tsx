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
      ],
      total: 2,
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
});
