import type { AgentApprovalStatus } from '@/api/agent-approvals.api';

/**
 * The status a person sees: a request past its expiry is Expired, whatever the row still says.
 * @param row - The request
 * @param row.status - Its status
 * @param row.expiresAt - When it expires
 * @param now - The time to judge by
 */
export function effectiveStatus(
  row: { status: AgentApprovalStatus; expiresAt: string },
  now: number = Date.now(),
): AgentApprovalStatus {
  return row.status === 'PENDING' && new Date(row.expiresAt).getTime() <= now
    ? 'EXPIRED'
    : row.status;
}

export const STATUS_LABELS: Record<AgentApprovalStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  EXECUTED: 'Executed',
  FAILED: 'Failed',
};

export const STATUS_VARIANTS: Record<
  AgentApprovalStatus,
  'default' | 'primary' | 'danger' | 'warning' | 'success'
> = {
  PENDING: 'warning',
  APPROVED: 'primary',
  REJECTED: 'default',
  EXPIRED: 'default',
  EXECUTED: 'success',
  FAILED: 'danger',
};

/** How the list and the badge keep up: expiry sends no event, so they ask again. */
export const REFETCH_MS = 20_000;

/**
 * The raw token a token-create approval returns once, to the person who approved it.
 * @param result - The result of the approved run
 */
export function secretTokenOf(result: unknown): string | null {
  if (result && typeof result === 'object' && 'token' in result) {
    const { token } = result as { token: unknown };
    return typeof token === 'string' ? token : null;
  }
  return null;
}
