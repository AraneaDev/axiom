import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, Mail, Monitor } from 'lucide-react';

import { notificationsApi, type NotificationPreference } from '@/api/notifications.api';
import { Card } from '@/components/ui/Card';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { Toggle } from '@/components/ui/Toggle';

const EVENT_TYPE_LABELS: Record<string, { label: string; description: string }> = {
  issue_assigned: {
    label: 'Issue assigned',
    description: 'When an issue is assigned to you',
  },
  issue_commented: {
    label: 'Issue commented',
    description: 'When someone comments on an issue you are involved in',
  },
  pr_review_requested: {
    label: 'Review requested',
    description: 'When someone requests your review on a pull request',
  },
  pr_merged: {
    label: 'Pull request merged',
    description: 'When a pull request you authored or reviewed is merged',
  },
  mention: {
    label: 'Mentions',
    description: 'When someone mentions you in a comment or description',
  },
};

/**
 *
 */
export default function NotificationSettings() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['notificationPreferences'],
    queryFn: notificationsApi.getPreferences,
  });

  const mutation = useMutation({
    mutationFn: ({
      eventType,
      settings,
    }: {
      eventType: string;
      settings: { inApp?: boolean; email?: boolean };
    }) => notificationsApi.updatePreference(eventType, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationPreferences'] });
      toast.success('Preference updated');
    },
    onError: () => {
      toast.error('Failed to update preference');
    },
  });

  function handleToggle(pref: NotificationPreference, field: 'inApp' | 'email', value: boolean) {
    mutation.mutate({ eventType: pref.eventType, settings: { [field]: value } });
  }

  if (isLoading)
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-7 w-52 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Card className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-4">
              <div>
                <Skeleton className="h-4 w-32 mb-1" />
                <Skeleton className="h-3 w-56" />
              </div>
              <div className="flex gap-6">
                <Skeleton className="h-5 w-9 rounded-full" />
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
            </div>
          ))}
        </Card>
      </div>
    );

  if (error) {
    return (
      <SettingsPage
        title="Notifications"
        description="Choose how and when you want to be notified"
        icon={Bell}
      >
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
            <p className="text-secondary">Failed to load notification preferences</p>
          </div>
        </div>
      </SettingsPage>
    );
  }

  const preferences = data?.preferences ?? [];

  return (
    <SettingsPage
      title="Notifications"
      description="Choose how and when you want to be notified"
      icon={Bell}
      helpTitle="Notification channels"
      helpItems={[
        {
          title: 'In-app notifications',
          description:
            'Appear in the notification center in the header. Unread notifications show a badge count.',
        },
        {
          title: 'Email notifications',
          description:
            'Sent to your account email address. Emails include a direct link to the relevant item.',
        },
        {
          title: 'Mentions',
          description:
            'You will always receive notifications when directly mentioned with @username, regardless of these settings.',
        },
      ]}
    >
      <Card>
        <div className="grid grid-cols-[1fr_80px_80px] items-center gap-4 px-4 py-3 border-b border-border bg-surface-secondary text-xs font-semibold text-text-secondary uppercase tracking-wide">
          <span>Event</span>
          <span className="text-center flex items-center justify-center gap-1">
            <Monitor className="h-3.5 w-3.5" /> In-app
          </span>
          <span className="text-center flex items-center justify-center gap-1 text-text-tertiary">
            <Mail className="h-3.5 w-3.5" /> Email
          </span>
        </div>

        {preferences.map((pref) => {
          const meta = EVENT_TYPE_LABELS[pref.eventType];
          return (
            <div
              key={pref.eventType}
              className="grid grid-cols-[1fr_80px_80px] items-center gap-4 px-4 py-3 border-b border-border-light last:border-b-0"
            >
              <div>
                <p className="text-sm font-medium text-text">{meta?.label ?? pref.eventType}</p>
                {meta?.description && (
                  <p className="text-xs text-text-tertiary mt-0.5">{meta.description}</p>
                )}
              </div>
              <div className="flex justify-center">
                <Toggle checked={pref.inApp} onChange={(val) => handleToggle(pref, 'inApp', val)} />
              </div>
              <div className="flex justify-center">
                <Toggle checked={pref.email} onChange={(val) => handleToggle(pref, 'email', val)} />
              </div>
            </div>
          );
        })}
      </Card>

      <p className="text-xs text-text-tertiary mt-4 flex items-center gap-1.5">
        <Mail className="h-3.5 w-3.5" />
        Email notifications are delivered to your account email address.
      </p>
    </SettingsPage>
  );
}
