import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import AuditLogs from './AuditLogs';

const entry = (over: object) => ({
  id: 'a',
  orgId: 'o',
  userId: 'user-id-1',
  userName: 'Sarah Chen',
  action: 'issue.update',
  resource: 'issue:1',
  details: null,
  via: 'claude-code',
  createdAt: '2026-11-05T10:00:00.000Z',
  ...over,
});

vi.mock('@/api/audit.api', () => ({
  auditApi: {
    list: async () => ({
      logs: [entry({}), entry({ id: 'b', userId: null, userName: null, via: null })],
      total: 2,
    }),
  },
}));

describe('AuditLogs', () => {
  it('names the user, with the agent beside it, and system for a row without a user', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AuditLogs />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Sarah Chen')).toBeTruthy();
    expect(screen.getByText(/claude-code/)).toBeTruthy();
    expect(screen.getByText('system')).toBeTruthy();
    expect(screen.queryByText('user-id-1')).toBeNull();
  });
});
