import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle, ShieldCheck, ThumbsDown, ThumbsUp, XCircle } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { approvalsApi, type ApprovalRequest } from '@/api/approvals.api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { Table, TableContainer, Tbody, Td, Th, Thead, TrHead } from '@/components/ui/Table';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { formatRelative } from '@/lib/utils';

/**
 *
 */
export default function MyApprovals() {
  const { org } = useParams();

  const {
    data: requests,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['my-pending-approvals'],
    queryFn: () => approvalsApi.myPendingApprovals(),
  });

  const voteMutation = useMutationWithToast(
    ({ requestId, decision }: { requestId: string; decision: 'APPROVED' | 'REJECTED' }) =>
      approvalsApi.castVote(requestId, { decision }),
    {
      successMessage: 'Vote submitted',
      errorMessage: 'Failed to submit vote',
      invalidateKeys: [['my-pending-approvals']],
    },
  );

  if (isLoading) return <ListSkeleton rows={6} />;

  if (error) {
    return (
      <EmptyState
        icon={<XCircle />}
        title="Failed to load approvals"
        description="Something went wrong loading your pending approvals."
      />
    );
  }

  return (
    <div>
      <PageHeader title="My Approvals">
        <ShieldCheck className="h-5 w-5 text-text-secondary" />
      </PageHeader>

      {requests && requests.length > 0 ? (
        <TableContainer>
          <Table>
            <Thead>
              <TrHead>
                <Th>Issue</Th>
                <Th>Title</Th>
                <Th>Transition</Th>
                <Th>Requested By</Th>
                <Th>Date</Th>
                <Th className="text-right">Actions</Th>
              </TrHead>
            </Thead>
            <Tbody>
              {requests.map((req: ApprovalRequest) => (
                <tr key={req.id}>
                  <Td>
                    {req.issue ? (
                      <Link
                        to={`/${org}/${req.issue.number}`}
                        className="text-primary hover:underline font-mono text-xs"
                      >
                        #{req.issue.number}
                      </Link>
                    ) : (
                      <span className="text-text-tertiary text-xs">--</span>
                    )}
                  </Td>
                  <Td className="font-medium max-w-xs truncate">
                    {req.issue?.title ?? 'Unknown issue'}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5 text-xs">
                      {req.approvalGate?.fromColumn && (
                        <span className="px-1.5 py-0.5 rounded bg-surface-tertiary text-text font-medium">
                          {req.approvalGate.fromColumn.name}
                        </span>
                      )}
                      <ArrowRight className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
                      <span className="px-1.5 py-0.5 rounded bg-surface-tertiary text-text font-medium">
                        {req.targetColumn?.name ?? 'Unknown'}
                      </span>
                    </div>
                  </Td>
                  <Td className="text-sm text-text-secondary">{req.requestedBy.displayName}</Td>
                  <Td className="text-sm text-text-tertiary">{formatRelative(req.createdAt)}</Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() =>
                          voteMutation.mutate({ requestId: req.id, decision: 'APPROVED' })
                        }
                        disabled={voteMutation.isPending}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() =>
                          voteMutation.mutate({ requestId: req.id, decision: 'REJECTED' })
                        }
                        disabled={voteMutation.isPending}
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                        Reject
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        </TableContainer>
      ) : (
        <EmptyState
          card
          icon={<CheckCircle className="h-10 w-10" />}
          title="No pending approvals"
          description="You have no approval requests waiting for your review."
        />
      )}
    </div>
  );
}
