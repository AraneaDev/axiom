import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CheckCheck,
  MessageSquare,
  GitPullRequest,
  UserCheck,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';

import { notificationsApi } from '@/api/notifications.api';
import type { Notification } from '@/api/notifications.api';
import { cn } from '@/lib/utils';

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function notificationIcon(type: string) {
  if (type.startsWith('issue:commented')) return MessageSquare;
  if (type.startsWith('issue:assigned')) return UserCheck;
  if (type.startsWith('pr:')) return GitPullRequest;
  return AlertCircle;
}

/**
 * Notification center dropdown for the header.
 */
export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const { data: countData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsApi.getUnreadCount(),
    refetchInterval: 30_000,
  });

  const { data: listData, isLoading } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => notificationsApi.list({ limit: 20 }),
    enabled: open,
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

  const unreadCount = countData?.count ?? 0;
  const notifications = listData?.notifications ?? [];

  function handleNotificationClick(notification: Notification) {
    if (!notification.read) {
      markReadMutation.mutate(notification.id);
    }
    if (notification.link) {
      navigate(notification.link);
    }
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-md hover:bg-surface-tertiary transition-colors relative"
        title="Notifications"
      >
        <Bell className="h-4 w-4 text-text-tertiary" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 rounded-xl border border-border bg-surface-elevated shadow-lg z-50 animate-fade-in overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllReadMutation.mutate()}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover transition-colors"
                title="Mark all as read"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-text-tertiary">
                <Bell className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              notifications.map((notification) => {
                const Icon = notificationIcon(notification.type);
                return (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={cn(
                      'flex items-start gap-3 w-full px-4 py-3 text-left hover:bg-surface-tertiary transition-colors border-b border-border-light last:border-b-0',
                      !notification.read && 'bg-primary-light/30',
                    )}
                  >
                    <div
                      className={cn(
                        'mt-0.5 flex-shrink-0 rounded-md p-1.5',
                        !notification.read
                          ? 'bg-primary-light text-primary'
                          : 'bg-surface-tertiary text-text-tertiary',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          'text-sm truncate',
                          !notification.read ? 'font-medium text-text' : 'text-text-secondary',
                        )}
                      >
                        {notification.title}
                      </p>
                      {notification.body && (
                        <p className="text-xs text-text-tertiary mt-0.5 truncate">
                          {notification.body}
                        </p>
                      )}
                      <p className="text-[11px] text-text-tertiary mt-1">
                        {timeAgo(notification.createdAt)}
                      </p>
                    </div>
                    {!notification.read && (
                      <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
