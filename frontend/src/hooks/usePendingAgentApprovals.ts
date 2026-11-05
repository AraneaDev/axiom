import { useQuery } from '@tanstack/react-query';

import { agentApprovalsApi } from '@/api/agent-approvals.api';
import { REFETCH_MS } from '@/lib/agent-approvals';

/**
 * How many agent requests wait for you. Counts the PENDING rows, not unread notifications: marking
 * a notification read must not clear it. Refetches, as an expired request sends no event.
 */
export function usePendingAgentApprovals(): number {
  const { data } = useQuery({
    queryKey: ['agent-approvals', 'pending-count'],
    queryFn: () => agentApprovalsApi.list({ status: 'PENDING', limit: 1 }),
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
  });
  return data?.total ?? 0;
}
