import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCheck,
  Eye,
  AtSign,
  Inbox,
  MessageSquare,
  GitPullRequest,
  UserCheck,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { notificationsApi } from '@/api/notifications.api';
import type { Notification } from '@/api/notifications.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { Tabs } from '@/components/ui/Tabs';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { cn, formatRelative } from '@/lib/utils';

const PAGE_SIZE = 20;

type FilterTab = 'all' | 'unread' | 'mentions' | 'watching';

function notificationIcon(type: string) {
  if (type.includes('comment') || type.includes('mention')) return MessageSquare;
  if (type.includes('assign')) return UserCheck;
  if (type.includes('pr:') || type.includes('pull')) return GitPullRequest;
  if (type.includes('watch')) return Eye;
  return AlertCircle;
}

function matchesFilter(notification: Notification, filter: FilterTab): boolean {
  switch (filter) {
    case 'unread':
      return !notification.read;
    case 'mentions':
      return notification.type.includes('mention') || notification.type.includes('comment');
    case 'watching':
      return notification.type.includes('watch');
    default:
      return true;
  }
}

const FILTER_TABS = [
  { key: 'all', label: 'All', icon: <Inbox className="h-4 w-4" /> },
  { key: 'unread', label: 'Unread', icon: <Bell className="h-4 w-4" /> },
  { key: 'mentions', label: 'Mentions', icon: <AtSign className="h-4 w-4" /> },
  { key: 'watching', label: 'Watching', icon: <Eye className="h-4 w-4" /> },
];

/**
 * Full-page notification inbox with filtering, pagination, and mark-as-read actions.
 */
export default function NotificationInbox() {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [page, setPage] = useState(0);

  const unreadOnly = filter === 'unread';

  const { data, isLoading, error } = useQuery({
    queryKey: ['notifications', 'inbox', { unreadOnly, page }],
    queryFn: () =>
      notificationsApi.list({
        unreadOnly,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  });

  const markReadMutation = useMutationWithToast((id: string) => notificationsApi.markRead(id), {
    successMessage: null,
    invalidateKeys: [['notifications']],
  });

  const markAllReadMutation = useMutationWithToast(() => notificationsApi.markAllRead(), {
    successMessage: null,
    invalidateKeys: [['notifications']],
  });

  const notifications = data?.notifications ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Client-side filter for mentions/watching (backend only supports unreadOnly)
  const filtered =
    filter === 'all' || filter === 'unread'
      ? notifications
      : notifications.filter((n) => matchesFilter(n, filter));

  // Sort: unread first, then by date
  const sorted = [...filtered].sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  function handleMarkRead(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    markReadMutation.mutate(id);
  }

  return (
    <div className="">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="h2">Notifications</h1>
          <p className="text-sm text-text-secondary mt-1">
            Stay up to date with activity across your projects
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => markAllReadMutation.mutate()}
          disabled={markAllReadMutation.isPending}
        >
          <CheckCheck className="h-4 w-4" />
          Mark all as read
        </Button>
      </div>

      <Tabs
        tabs={FILTER_TABS}
        activeKey={filter}
        onChange={(key) => {
          setFilter(key as FilterTab);
          setPage(0);
        }}
        className="mb-4"
      />

      {error ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
            <p className="text-secondary">Failed to load notifications</p>
          </div>
        </div>
      ) : isLoading ? (
        <ListSkeleton rows={8} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title={filter === 'unread' ? 'All caught up' : 'No notifications yet'}
          description={
            filter === 'unread'
              ? 'You have no unread notifications.'
              : 'Notifications will appear here when there is activity on issues, pull requests, and other items you are involved with.'
          }
        />
      ) : (
        <>
          <Card className="divide-y divide-border">
            {sorted.map((notification) => {
              const Icon = notificationIcon(notification.type);
              const rowClass = cn(
                'flex items-center gap-4 w-full px-4 py-3 text-left hover:bg-surface-tertiary transition-colors',
                !notification.read && 'bg-primary-light/20',
              );

              const content = (
                <>
                  <div
                    className={cn(
                      'flex-shrink-0 rounded-md p-2',
                      !notification.read
                        ? 'bg-primary-light text-primary'
                        : 'bg-surface-tertiary text-text-tertiary',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p
                        className={cn(
                          'text-sm truncate',
                          !notification.read ? 'font-semibold text-text' : 'text-text-secondary',
                        )}
                      >
                        {notification.title}
                      </p>
                      {!notification.read && (
                        <Badge variant="primary" size="sm">
                          New
                        </Badge>
                      )}
                    </div>
                    {notification.body && (
                      <p className="text-xs text-text-tertiary mt-0.5 truncate">
                        {notification.body}
                      </p>
                    )}
                  </div>

                  <span className="text-xs text-text-tertiary whitespace-nowrap flex-shrink-0">
                    {formatRelative(notification.createdAt)}
                  </span>

                  {!notification.read && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={(e) => handleMarkRead(e, notification.id)}
                      className="flex-shrink-0 p-1.5"
                      title="Mark as read"
                    >
                      <Check className="h-4 w-4 text-text-tertiary hover:text-primary" />
                    </Button>
                  )}

                  {notification.read && <div className="w-[30px] flex-shrink-0" />}
                </>
              );

              return notification.link ? (
                <Link
                  key={notification.id}
                  to={notification.link}
                  onClick={() => {
                    if (!notification.read) markReadMutation.mutate(notification.id);
                  }}
                  className={rowClass}
                >
                  {content}
                </Link>
              ) : (
                <div key={notification.id} className={rowClass}>
                  {content}
                </div>
              );
            })}
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-text-secondary">
                Showing {page * PAGE_SIZE + 1}--{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
