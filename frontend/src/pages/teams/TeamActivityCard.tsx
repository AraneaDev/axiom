import { Clock } from 'lucide-react';
import { Link } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ViaLabel } from '@/components/ui/ViaLabel';
import { formatRelative } from '@/lib/utils';

const ACTION_LABELS: Record<string, string> = {
  created: 'created',
  updated: 'updated',
  status_changed: 'changed status of',
  assigned: 'assigned',
  unassigned: 'unassigned',
  commented: 'commented on',
  closed: 'closed',
  labeled: 'labeled',
  priority_changed: 'changed priority of',
  type_changed: 'changed type of',
  deleted: 'deleted',
  time_logged: 'logged time on',
};

interface ActivityItem {
  id: string;
  action: string;
  resourceTitle?: string | null;
  resourceKey?: string | null;
  resourceType?: string | null;
  resourceLink?: string | null;
  createdAt: string;
  via?: string | null;
  user: {
    displayName: string;
    username: string;
    avatarUrl?: string | null;
  };
}

interface TeamActivityCardProps {
  activity: ActivityItem[] | undefined;
  orgSlug: string | undefined;
  teamSlug: string | undefined;
}

/**
 *
 * @param root0
 * @param root0.activity
 * @param root0.orgSlug
 * @param root0.teamSlug
 */
export function TeamActivityCard({ activity, orgSlug, teamSlug }: TeamActivityCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary">
          Recent Activity
        </h3>
        {activity && activity.length > 0 && (
          <Badge variant="default" size="sm">
            {activity.length}
          </Badge>
        )}
      </div>
      {!activity?.length ? (
        <p className="text-sm text-text-tertiary py-3">No recent activity.</p>
      ) : (
        <div className="space-y-0 divide-y divide-border-light">
          {activity.slice(0, 5).map((a) => {
            const actionLabel = ACTION_LABELS[a.action] ?? a.action.replace(/_/g, ' ');

            const resourceContent = a.resourceTitle ? (
              <>
                {a.resourceKey && (
                  <span className="font-mono text-xs text-text-secondary">{a.resourceKey}</span>
                )}{' '}
                <span className="text-text">{a.resourceTitle}</span>
              </>
            ) : (
              <span className="text-text-secondary">
                {a.resourceType?.replace(/_/g, ' ').toLowerCase()}
              </span>
            );

            return (
              <div key={a.id} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
                <Avatar
                  name={a.user.displayName}
                  src={a.user.avatarUrl ?? undefined}
                  size="sm"
                  className="mt-0.5 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-snug">
                    <Link
                      to={`/${orgSlug}/${teamSlug}/members/${a.user.username}`}
                      className="font-medium text-text hover:text-primary transition-colors"
                    >
                      {a.user.displayName}
                    </Link>{' '}
                    <ViaLabel via={a.via} />{' '}
                    <span className="text-text-secondary">{actionLabel}</span>{' '}
                    {a.resourceLink ? (
                      <Link to={a.resourceLink} className="text-primary hover:underline">
                        {resourceContent}
                      </Link>
                    ) : (
                      resourceContent
                    )}
                  </p>
                  <span className="text-xs text-text-tertiary flex items-center gap-1 mt-0.5">
                    <Clock className="h-3 w-3" /> {formatRelative(a.createdAt)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
