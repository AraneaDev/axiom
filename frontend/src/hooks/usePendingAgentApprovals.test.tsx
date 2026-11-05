import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const list = vi.hoisted(() => vi.fn());

vi.mock('@/api/agent-approvals.api', () => ({ agentApprovalsApi: { list } }));

import { usePendingAgentApprovals } from './usePendingAgentApprovals';

describe('usePendingAgentApprovals', () => {
  it('counts the pending requests, which the notification read state does not change', async () => {
    list.mockResolvedValue({ data: [], total: 3 });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => usePendingAgentApprovals(), { wrapper });
    await waitFor(() => expect(result.current).toBe(3));
    expect(list).toHaveBeenCalledWith({ status: 'PENDING', limit: 1 });
  });
});
