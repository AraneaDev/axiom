import { Check, User } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { usersApi } from '@/api/users.api';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { Spinner } from '@/components/ui/Spinner';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useAuthStore } from '@/stores/auth.store';

/**
 *
 */
export default function Profile() {
  const { user } = useAuthStore();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [saved, setSaved] = useState(false);

  const mutation = useMutationWithToast(() => usersApi.updateMe({ displayName }), {
    successMessage: null,
    invalidateKeys: [['me']],
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <SettingsPage
      title="Profile"
      description="Manage your personal information and account details"
      icon={User}
      helpTitle="About your profile"
      helpItems={[
        {
          title: 'Display name',
          description:
            'Your display name is visible to other members across all organizations you belong to.',
        },
        {
          title: 'Email & Username',
          description:
            'Your email and username are set during account creation and cannot be changed. Contact an administrator if you need to update them.',
        },
        {
          title: 'Avatar',
          description: 'Avatars are automatically generated based on your display name.',
        },
      ]}
    >
      <Card className="p-6 mb-6">
        <div className="flex items-center gap-4">
          <Avatar name={user?.displayName ?? 'User'} size="lg" />
          <div>
            <p className="font-medium text-text">{user?.displayName}</p>
            <p className="text-sm text-text-secondary">@{user?.username}</p>
            <p className="text-sm text-text-tertiary">{user?.email}</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-sm font-semibold text-text mb-4">Account details</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            id="displayName"
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
          <Input
            id="email"
            label="Email"
            value={user?.email ?? ''}
            disabled
            hint="Email cannot be changed"
          />
          <Input
            id="username"
            label="Username"
            value={user?.username ?? ''}
            disabled
            hint="Username cannot be changed"
          />
          <div className="flex items-center gap-3 pt-2 border-t border-border-light">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <Spinner size="sm" />
              ) : (
                <>
                  <Check className="h-4 w-4" /> Save changes
                </>
              )}
            </Button>
            {saved && <span className="text-sm text-success">Saved!</span>}
          </div>
        </form>
      </Card>
    </SettingsPage>
  );
}
