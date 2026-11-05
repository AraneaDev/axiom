import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

const create = vi.hoisted(() => vi.fn());

vi.mock('@/api/orgs.api', () => ({ orgsApi: { create } }));
vi.mock('@/components/editor/MarkdownEditor', () => ({ MarkdownEditor: () => null }));

import { ToastProvider } from '@/components/ui/Toast';

import CreateOrg from './CreateOrg';

describe('CreateOrg', () => {
  it('says why the server refused the slug', async () => {
    create.mockRejectedValue(new Error('slug: This slug is reserved by the app, choose another'));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <CreateOrg />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Organization name'), {
      target: { value: 'Dashboards' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(await screen.findByText(/reserved by the app/)).toBeInTheDocument();
  });
});
