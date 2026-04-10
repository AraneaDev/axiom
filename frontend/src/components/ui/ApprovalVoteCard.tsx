import { CheckCircle, XCircle } from 'lucide-react';
import { forwardRef, type HTMLAttributes } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/utils';

interface ApprovalVoteCardUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

interface ApprovalVoteCardProps extends HTMLAttributes<HTMLDivElement> {
  user: ApprovalVoteCardUser;
  decision: 'APPROVED' | 'REJECTED';
  comment: string | null;
  createdAt: string;
}

/**
 * Card displaying a single approval vote with user info, decision badge, date, and optional comment.
 * @param props - Vote card props.
 */
export const ApprovalVoteCard = forwardRef<HTMLDivElement, ApprovalVoteCardProps>(
  ({ user, decision, comment, createdAt, className, ...props }, ref) => {
    const isApproved = decision === 'APPROVED';
    const date = new Date(createdAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    return (
      <div
        ref={ref}
        className={cn(
          'flex items-start gap-3 p-3 rounded-lg border border-border-light bg-surface-secondary',
          className,
        )}
        {...props}
      >
        <Avatar name={user.displayName} src={user.avatarUrl ?? undefined} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text">{user.displayName}</span>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium leading-none',
                isApproved ? 'bg-success-light text-success' : 'bg-danger-light text-danger',
              )}
            >
              {isApproved ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
              {isApproved ? 'Approved' : 'Rejected'}
            </span>
            <span className="text-xs text-text-tertiary ml-auto">{date}</span>
          </div>
          {comment && <p className="mt-1 text-xs text-text-secondary leading-relaxed">{comment}</p>}
        </div>
      </div>
    );
  },
);
ApprovalVoteCard.displayName = 'ApprovalVoteCard';
