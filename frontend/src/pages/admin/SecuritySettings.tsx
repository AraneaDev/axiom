import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { siteSettingsApi } from '@/api/site-settings.api';
import type { SiteSettings } from '@/api/site-settings.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';

const REGISTRATION_MODES = [
  {
    value: 'INVITE_ONLY' as const,
    label: 'Invite Only',
    description: 'Users must have a valid invite link to register',
  },
  {
    value: 'OPEN' as const,
    label: 'Open Registration',
    description: 'Anyone can create an account',
  },
  {
    value: 'DISABLED' as const,
    label: 'Disabled',
    description: 'No new registrations allowed',
  },
];

function SecuritySettingsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8" />
        <Skeleton className="h-6 w-48" />
      </div>
      <Card className="p-6">
        <Skeleton className="h-5 w-40 mb-4" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </Card>
      <Card className="p-6">
        <Skeleton className="h-5 w-56 mb-4" />
        <Skeleton className="h-12 w-full" />
      </Card>
    </div>
  );
}

function SecuritySettingsForm({ settings }: { settings: SiteSettings }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [registrationMode, setRegistrationMode] = useState<SiteSettings['registrationMode']>(
    settings.registrationMode,
  );
  const [enforce2fa, setEnforce2fa] = useState(settings.enforce2fa);
  const [dirty, setDirty] = useState(false);

  const mutation = useMutation({
    mutationFn: () => siteSettingsApi.update({ registrationMode, enforce2fa }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-settings'] });
      setDirty(false);
    },
  });

  function handleModeChange(mode: SiteSettings['registrationMode']) {
    setRegistrationMode(mode);
    setDirty(true);
  }

  function handleEnforce2faChange() {
    setEnforce2fa((prev) => !prev);
    setDirty(true);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
            <ArrowLeft className="h-4 w-4" /> Back to admin
          </Button>
          <div>
            <h1 className="h2">Security Settings</h1>
            <p className="text-sm text-text-secondary mt-0.5">
              Manage registration and authentication policies
            </p>
          </div>
        </div>
        <Button onClick={() => mutation.mutate()} disabled={!dirty || mutation.isPending} size="sm">
          {mutation.isPending ? <Spinner size="sm" /> : <Save className="h-4 w-4" />}
          Save Changes
        </Button>
      </div>

      {/* Error display */}
      {mutation.isError && (
        <div className="rounded-md bg-danger-light border border-danger/20 px-4 py-3 text-sm text-danger">
          {mutation.error instanceof Error ? mutation.error.message : 'Failed to save settings'}
        </div>
      )}

      {/* Success display */}
      {mutation.isSuccess && !dirty && (
        <div className="rounded-md bg-success-light border border-success/20 px-4 py-3 text-sm text-success">
          Settings saved successfully
        </div>
      )}

      {/* Registration Mode */}
      <Card className="p-6">
        <h2 className="text-sm font-semibold text-text mb-1">Registration Mode</h2>
        <p className="text-xs text-text-tertiary mb-4">Control how new users can create accounts</p>
        <div className="flex flex-col gap-2">
          {REGISTRATION_MODES.map((mode) => (
            <label
              key={mode.value}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors',
                registrationMode === mode.value
                  ? 'border-primary bg-primary-light'
                  : 'border-border hover:border-border-hover',
              )}
            >
              <input
                type="radio"
                name="registrationMode"
                value={mode.value}
                checked={registrationMode === mode.value}
                onChange={() => handleModeChange(mode.value)}
                className="mt-0.5 accent-primary"
              />
              <div>
                <span className="text-sm font-medium text-text">{mode.label}</span>
                <p className="text-xs text-text-secondary mt-0.5">{mode.description}</p>
              </div>
            </label>
          ))}
        </div>
      </Card>

      {/* Enforce 2FA */}
      <Card className="p-6">
        <h2 className="text-sm font-semibold text-text mb-1">Two-Factor Authentication</h2>
        <p className="text-xs text-text-tertiary mb-4">
          Require all users to set up two-factor authentication
        </p>
        <label
          className={cn(
            'flex items-center justify-between rounded-lg border p-4 cursor-pointer transition-colors',
            enforce2fa
              ? 'border-primary bg-primary-light'
              : 'border-border hover:border-border-hover',
          )}
        >
          <div>
            <span className="text-sm font-medium text-text">Enforce 2FA for all users</span>
            <p className="text-xs text-text-secondary mt-0.5">
              {enforce2fa
                ? 'All users must set up 2FA. Users without 2FA will be required to set it up on next login.'
                : 'Users can optionally enable 2FA from their security settings'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enforce2fa}
            onClick={handleEnforce2faChange}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors',
              enforce2fa ? 'bg-primary' : 'bg-border',
            )}
          >
            <span
              className={cn(
                'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform mt-0.5',
                enforce2fa ? 'translate-x-5 ml-0.5' : 'translate-x-0.5',
              )}
            />
          </button>
        </label>
      </Card>
    </div>
  );
}

/**
 *
 */
export default function SecuritySettings() {
  const { data: settings, isLoading } = useQuery<SiteSettings>({
    queryKey: ['site-settings'],
    queryFn: siteSettingsApi.get,
  });

  if (isLoading || !settings) return <SecuritySettingsSkeleton />;

  return <SecuritySettingsForm settings={settings} />;
}
