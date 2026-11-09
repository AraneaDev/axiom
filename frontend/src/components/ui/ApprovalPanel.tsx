import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ThumbsDown, ThumbsUp, X } from 'lucide-react';

import { approvalsApi, type ApprovalRequest } from '@/api/approvals.api';
import { ApprovalBadge } from '@/components/ui/ApprovalBadge';
import { ApprovalVoteCard } from '@/components/ui/ApprovalVoteCard';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { UserName } from '@/components/ui/UserName';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useAuthStore } from '@/stores/auth.store';

interface ApprovalPanelProps {
  issueId: string;
}

/**
 * Panel displaying all approval requests for an issue with voting and cancel actions.
 * @param props - Panel props.
 * @param props.issueId - The issue ID to load approval requests for.
 */
export function ApprovalPanel({ issueId }: ApprovalPanelProps) {
  const currentUser = useAuthStore((s) => s.user);

  const { data: requests, isLoading } = useQuery({
    queryKey: ['approval-requests', issueId],
    queryFn: () => approvalsApi.listRequestsForIssue(issueId),
    enabled: !!issueId,
  });

  const voteMutation = useMutationWithToast(
    ({
      requestId,
      decision,
      comment,
    }: {
      requestId: string;
      decision: 'APPROVED' | 'REJECTED';
      comment?: string;
    }) => approvalsApi.castVote(requestId, { decision, comment }),
    {
      successMessage: 'Vote submitted',
      errorMessage: 'Failed to submit vote',
      invalidateKeys: [['approval-requests', issueId]],
    },
  );

  const cancelMutation = useMutationWithToast(
    (requestId: string) => approvalsApi.cancelRequest(requestId),
    {
      successMessage: 'Approval request cancelled',
      errorMessage: 'Failed to cancel request',
      invalidateKeys: [['approval-requests', issueId]],
    },
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="sm" />
      </div>
    );
  }

  if (!requests || requests.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck />}
        title="No approval requests"
        description="Approval requests will appear here when a gated column transition is initiated."
      />
    );
  }

  return (
    <div className="space-y-4">
      {requests.map((request: ApprovalRequest) => {
        const hasVoted = currentUser
          ? request.votes.some((v) => v.userId === currentUser.id)
          : false;
        const isRequester = currentUser?.id === request.requestedById;
        const isPending = request.status === 'PENDING';

        return (
          <div
            key={request.id}
            className="rounded-xl border border-border bg-surface-elevated p-4 space-y-3"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <ApprovalBadge
                  status={request.status}
                  targetColumnName={request.targetColumn?.name}
                />
                {request.targetColumn && (
                  <span className="text-xs text-text-secondary">
                    to <span className="font-medium text-text">{request.targetColumn.name}</span>
                  </span>
                )}
              </div>
              {isPending && isRequester && (
                <Button
                  variant="ghost"
                  size="xs"
                  title="Cancel request"
                  onClick={() => cancelMutation.mutate(request.id)}
                  disabled={cancelMutation.isPending}
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </Button>
              )}
            </div>

            {/* Requester */}
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              <Avatar
                name={request.requestedBy.displayName}
                src={request.requestedBy.avatarUrl ?? undefined}
                size="xs"
              />
              <span>
                Requested by{' '}
                <span className="font-medium text-text">
                  <UserName user={request.requestedBy} />
                </span>
              </span>
              <span className="text-text-tertiary">
                {new Date(request.createdAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>

            {/* Votes */}
            {request.votes.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-text-secondary">
                  Votes ({request.votes.length})
                </p>
                {request.votes.map((vote) => (
                  <ApprovalVoteCard
                    key={vote.id}
                    user={vote.user}
                    decision={vote.decision}
                    comment={vote.comment}
                    createdAt={vote.createdAt}
                  />
                ))}
              </div>
            )}

            {/* Vote actions */}
            {isPending && currentUser && !hasVoted && !isRequester && (
              <div className="flex items-center gap-2 pt-1 border-t border-border-light">
                <span className="text-xs text-text-secondary flex-1">Cast your vote:</span>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    voteMutation.mutate({ requestId: request.id, decision: 'APPROVED' })
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
                    voteMutation.mutate({ requestId: request.id, decision: 'REJECTED' })
                  }
                  disabled={voteMutation.isPending}
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                  Reject
                </Button>
              </div>
            )}

            {isPending && currentUser && !hasVoted && isRequester && (
              <p className="text-xs text-text-tertiary border-t border-border-light pt-2">
                Awaiting votes from approvers.
              </p>
            )}

            {isPending && currentUser && hasVoted && (
              <p className="text-xs text-text-tertiary border-t border-border-light pt-2">
                You have already voted on this request.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
