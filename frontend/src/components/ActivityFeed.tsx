import {
  GitCommit,
  MessageSquare,
  ArrowRight,
  UserPlus,
  UserMinus,
  Tag,
  Plus,
  Trash2,
  GitMerge,
  XCircle,
  ClipboardCheck,
  AlertTriangle,
  FileText,
  Paperclip,
  Pencil,
} from 'lucide-react';

import type { ActivityEvent } from '@/api/activity.api';
import { cn, formatRelative } from '@/lib/utils';

const ACTION_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  created: { icon: Plus, label: 'created', color: 'text-success' },
  updated: { icon: Pencil, label: 'updated', color: 'text-text-secondary' },
  status_changed: { icon: ArrowRight, label: 'changed status', color: 'text-primary' },
  assigned: { icon: UserPlus, label: 'assigned', color: 'text-primary' },
  unassigned: { icon: UserMinus, label: 'unassigned', color: 'text-text-secondary' },
  commented: { icon: MessageSquare, label: 'commented', color: 'text-primary' },
  merged: { icon: GitMerge, label: 'merged', color: 'text-success' },
  closed: { icon: XCircle, label: 'closed', color: 'text-danger' },
  labeled: { icon: Tag, label: 'updated labels', color: 'text-warning' },
  unlabeled: { icon: Tag, label: 'removed label', color: 'text-text-secondary' },
  priority_changed: { icon: AlertTriangle, label: 'changed priority', color: 'text-warning' },
  type_changed: { icon: FileText, label: 'changed type', color: 'text-text-secondary' },
  review_submitted: { icon: ClipboardCheck, label: 'submitted review', color: 'text-primary' },
  deleted: { icon: Trash2, label: 'deleted', color: 'text-danger' },
  commit: { icon: GitCommit, label: 'committed', color: 'text-text-secondary' },
  attachment_added: { icon: Paperclip, label: 'added attachment', color: 'text-success' },
  attachment_removed: { icon: Paperclip, label: 'removed attachment', color: 'text-danger' },
};

function getActionConfig(action: string) {
  return ACTION_CONFIG[action] ?? { icon: GitCommit, label: action, color: 'text-text-secondary' };
}

function formatDetails(action: string, details: Record<string, unknown> | null): string {
  if (!details) return '';

  if (action === 'status_changed' && details.fromName && details.toName) {
    return `from ${details.fromName} to ${details.toName}`;
  }
  if (action === 'status_changed' && details.from && details.to) {
    return `from ${String(details.from)} to ${String(details.to)}`;
  }
  if (action === 'priority_changed' && details.from && details.to) {
    return `from ${String(details.from)} to ${String(details.to)}`;
  }
  if (action === 'type_changed' && details.from && details.to) {
    return `from ${String(details.from)} to ${String(details.to)}`;
  }
  if (action === 'assigned' && details.to) {
    return '';
  }
  if (action === 'updated' && details.field) {
    return String(details.field);
  }
  if (action === 'labeled' && Array.isArray(details.labels)) {
    return (details.labels as string[]).join(', ');
  }
  if (action === 'review_submitted' && details.status) {
    const statusMap: Record<string, string> = {
      APPROVED: 'approved',
      CHANGES_REQUESTED: 'requested changes',
      COMMENTED: 'commented',
    };
    return statusMap[String(details.status)] ?? String(details.status);
  }
  if (action === 'created' && details.title) {
    return String(details.title);
  }
  if ((action === 'attachment_added' || action === 'attachment_removed') && details.fileName) {
    return String(details.fileName);
  }

  return '';
}

interface ActivityFeedProps {
  activities: ActivityEvent[];
  className?: string;
}

/**
 *
 * @param root0
 * @param root0.activities
 * @param root0.className
 */
export function ActivityFeed({ activities, className }: ActivityFeedProps) {
  if (activities.length === 0) {
    return <p className="text-sm text-text-tertiary py-4">No activity yet.</p>;
  }

  return (
    <div className={cn('relative', className)}>
      {/* Vertical timeline line */}
      <div className="absolute left-4 top-6 bottom-2 w-px bg-border-light" />

      <div className="space-y-3">
        {activities.map((event) => {
          const config = getActionConfig(event.action);
          const Icon = config.icon;
          const detailText = formatDetails(event.action, event.details);

          return (
            <div key={event.id} className="relative flex items-start gap-3">
              {/* Icon circle */}
              <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface border border-border">
                <Icon className={cn('h-3.5 w-3.5', config.color)} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pt-1">
                <p className="text-sm">
                  <span className="font-medium text-text">{event.user.displayName}</span>{' '}
                  <span className="text-text-secondary">{config.label}</span>
                  {detailText && <span className="text-text-tertiary"> {detailText}</span>}
                  <span className="text-text-tertiary ml-2 text-xs">
                    {formatRelative(event.createdAt)}
                  </span>
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
