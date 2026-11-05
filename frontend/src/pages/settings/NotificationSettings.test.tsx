import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPreferences = vi.hoisted(() => vi.fn());

vi.mock('@/api/notifications.api', () => ({
  notificationsApi: { getPreferences, updatePreference: vi.fn() },
}));

import { ToastProvider } from '@/components/ui/Toast';

import NotificationSettings from './NotificationSettings';

function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <MemoryRouter>
          <NotificationSettings />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('NotificationSettings', () => {
  beforeEach(() => {
    getPreferences.mockReset();
    getPreferences.mockResolvedValue({
      preferences: [
        { eventType: 'mention', inApp: true, email: false },
        { eventType: 'agent:approval', inApp: true, email: false },
      ],
    });
  });

  it('labels agent approval requests and offers only email for them', async () => {
    show();
    const label = await screen.findByText('Agent approval requests');
    expect(screen.queryByText('agent:approval')).not.toBeInTheDocument();
    const row = label.closest('div[class*="grid"]') as HTMLElement;
    expect(within(row).getByText('Always')).toBeInTheDocument();
    expect(within(row).getAllByRole('switch')).toHaveLength(1);
  });

  it('keeps both toggles for the other events', async () => {
    show();
    const label = (await screen.findAllByText('Mentions'))[0];
    const row = label.closest('div[class*="grid"]') as HTMLElement;
    expect(within(row).getAllByRole('switch')).toHaveLength(2);
  });
});
