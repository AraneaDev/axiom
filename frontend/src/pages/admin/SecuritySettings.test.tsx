import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/api/site-settings.api', () => ({
  siteSettingsApi: {
    get: vi.fn().mockResolvedValue({ registrationMode: 'OPEN', enforce2fa: false }),
    update: vi.fn(),
  },
}));

import SecuritySettings from './SecuritySettings';

describe('SecuritySettings', () => {
  it('has a back link to the admin page, not a button', async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <SecuritySettings />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const link = await screen.findByRole('link', { name: /back to admin/i });
    expect(link).toHaveAttribute('href', '/admin');
    expect(screen.queryByRole('button', { name: /back to admin/i })).toBeNull();
  });
});
