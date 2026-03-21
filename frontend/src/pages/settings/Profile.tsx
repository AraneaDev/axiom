import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { usersApi } from '@/api/users.api';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useAuthStore } from '@/stores/auth.store';

/**
 *
 */
export default function Profile() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: () => usersApi.updateMe({ displayName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Profile</h1>

      <div className="rounded-lg border border-border bg-surface p-6 mb-6">
        <div className="flex items-center gap-4">
          <Avatar name={user?.displayName ?? 'User'} size="lg" />
          <div>
            <p className="font-medium text-text">{user?.displayName}</p>
            <p className="text-sm text-text-secondary">@{user?.username}</p>
            <p className="text-sm text-text-tertiary">{user?.email}</p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6">
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
                <Spinner className="h-4 w-4" />
              ) : (
                <>
                  <Check className="h-4 w-4" /> Save changes
                </>
              )}
            </Button>
            {saved && <span className="text-sm text-success">Saved!</span>}
          </div>
        </form>
      </div>
    </div>
  );
}
