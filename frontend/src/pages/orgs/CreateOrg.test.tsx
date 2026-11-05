import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.hoisted(() => vi.fn());

vi.mock('@/api/orgs.api', () => ({ orgsApi: { create } }));
vi.mock('@/components/editor/MarkdownEditor', () => ({ MarkdownEditor: () => null }));

import { ToastProvider } from '@/components/ui/Toast';

import CreateOrg from './CreateOrg';

function submitWith(failure: Error) {
  create.mockRejectedValue(failure);
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
}

const slugField = () => screen.getByLabelText('URL slug');

describe('CreateOrg', () => {
  beforeEach(() => {
    create.mockReset();
  });

  it('says on the slug field why the server refused the slug', async () => {
    submitWith(new Error('slug: This slug is reserved by the app, choose another'));
    expect(await screen.findByText(/reserved by the app/)).toBeInTheDocument();
    expect(slugField()).toHaveAttribute('aria-invalid', 'true');
  });

  it('says on the slug field that the slug is taken', async () => {
    submitWith(new Error('Organization slug already taken'));
    expect(await screen.findByText(/already taken/)).toBeInTheDocument();
    expect(slugField()).toHaveAttribute('aria-invalid', 'true');
  });

  it('toasts any other failure and leaves the slug field alone', async () => {
    submitWith(new Error('The server is having a moment'));
    expect(await screen.findByText(/having a moment/)).toBeInTheDocument();
    expect(slugField()).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the slug error when the slug is edited, by hand or through the name', async () => {
    submitWith(new Error('slug: This slug is reserved by the app, choose another'));
    await screen.findByText(/reserved by the app/);
    fireEvent.change(slugField(), { target: { value: 'dashboards-two' } });
    await waitFor(() => expect(slugField()).not.toHaveAttribute('aria-invalid', 'true'));

    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(slugField()).toHaveAttribute('aria-invalid', 'true'));
    fireEvent.change(screen.getByLabelText('Organization name'), {
      target: { value: 'Another name' },
    });
    await waitFor(() => expect(slugField()).not.toHaveAttribute('aria-invalid', 'true'));
  });
});
