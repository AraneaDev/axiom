import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
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
import { useNavigate } from 'react-router';

import { notificationsApi } from '@/api/notifications.api';
import type { Notification } from '@/api/notifications.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { Tabs } from '@/components/ui/Tabs';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

type FilterTab = 'all' | 'unread' | 'mentions' | 'watching';

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const unreadOnly = filter === 'unread';

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'inbox', { unreadOnly, page }],
    queryFn: () =>
      notificationsApi.list({
        unreadOnly,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
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

  function handleNotificationClick(notification: Notification) {
    if (!notification.read) {
      markReadMutation.mutate(notification.id);
    }
    if (notification.link) {
      navigate(notification.link);
    }
  }

  function handleMarkRead(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    markReadMutation.mutate(id);
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text">Notifications</h1>
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

      {isLoading ? (
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
          <div className="rounded-lg border border-border bg-surface divide-y divide-border">
            {sorted.map((notification) => {
              const Icon = notificationIcon(notification.type);
              return (
                <button
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={cn(
                    'flex items-center gap-4 w-full px-4 py-3 text-left hover:bg-surface-tertiary transition-colors',
                    !notification.read && 'bg-primary-light/20',
                  )}
                >
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
                    {timeAgo(notification.createdAt)}
                  </span>

                  {!notification.read && (
                    <button
                      onClick={(e) => handleMarkRead(e, notification.id)}
                      className="flex-shrink-0 p-1.5 rounded-md hover:bg-surface-secondary transition-colors"
                      title="Mark as read"
                    >
                      <Check className="h-4 w-4 text-text-tertiary hover:text-primary" />
                    </button>
                  )}

                  {notification.read && <div className="w-[30px] flex-shrink-0" />}
                </button>
              );
            })}
          </div>

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
