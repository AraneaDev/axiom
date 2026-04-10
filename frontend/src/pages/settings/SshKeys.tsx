import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Key, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { usersApi } from '@/api/users.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { Skeleton, ListSkeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { formatDate } from '@/lib/utils';

/**
 *
 */
export default function SshKeys() {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const {
    data: keys,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: ['sshKeys'],
    queryFn: usersApi.listSshKeys,
  });

  const addMutation = useMutationWithToast(() => usersApi.addSshKey({ title, publicKey }), {
    successMessage: 'SSH key added',
    errorMessage: null,
    invalidateKeys: [['sshKeys']],
    onSuccess: () => {
      setShowForm(false);
      setTitle('');
      setPublicKey('');
    },
    onError: (err) => setError(err.message || 'Failed to add SSH key'),
  });

  const deleteMutation = useMutationWithToast((keyId: string) => usersApi.deleteSshKey(keyId), {
    successMessage: 'SSH key deleted',
    invalidateKeys: [['sshKeys']],
  });

  function handleDelete(keyId: string) {
    deleteMutation.mutate(keyId);
  }

  if (isLoading)
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-7 w-32 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <ListSkeleton rows={3} />
      </div>
    );

  if (queryError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load SSH keys</p>
        </div>
      </div>
    );
  }

  return (
    <SettingsPage
      title="SSH Keys"
      description="Manage SSH public keys for secure git access"
      icon={Key}
      helpTitle="Using SSH keys"
      helpItems={[
        {
          title: 'Generating a key',
          description:
            'Run ssh-keygen -t ed25519 in your terminal to generate a new key pair. Copy the contents of the .pub file.',
        },
        {
          title: 'Multiple keys',
          description:
            'You can add multiple SSH keys, for example one per device. Each key must be unique across all accounts.',
        },
        {
          title: 'Key format',
          description:
            'Supported formats include Ed25519, RSA (2048+ bits), and ECDSA. Ed25519 is recommended for security and performance.',
        },
      ]}
      actions={
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4" /> Add Key
        </Button>
      }
    >
      {showForm && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-text mb-4">Add new SSH key</h3>
          {error && (
            <div className="mb-4 rounded-md bg-danger-light border border-danger/20 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
          <div className="space-y-4">
            <Input
              id="keyTitle"
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My laptop"
            />
            <Textarea
              id="publicKey"
              label="Public key"
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              className="text-xs font-mono"
              rows={4}
              placeholder="ssh-ed25519 AAAA..."
            />
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => addMutation.mutate()}
                disabled={addMutation.isPending || !title || !publicKey}
              >
                {addMutation.isPending ? (
                  <Spinner size="sm" />
                ) : (
                  <>
                    <Plus className="h-4 w-4" /> Add key
                  </>
                )}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>
                <X className="h-4 w-4" /> Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {!keys?.length ? (
        <EmptyState
          card
          icon={<Key className="h-10 w-10" />}
          title="No SSH keys"
          description="Add an SSH key to clone repos over SSH."
        />
      ) : (
        <Card className="divide-y divide-border">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center gap-3 p-4 hover:bg-surface-secondary/50 transition-colors"
            >
              <div className="h-8 w-8 rounded-lg bg-surface-secondary flex items-center justify-center shrink-0">
                <Key className="h-4 w-4 text-text-tertiary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text">{k.title}</p>
                <p className="text-xs text-text-tertiary font-mono truncate">{k.fingerprint}</p>
              </div>
              <span className="text-xs text-text-tertiary shrink-0">
                Added {formatDate(k.createdAt)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteId(k.id)}
                title="Delete key"
              >
                <Trash2 className="h-3.5 w-3.5 text-danger" />
              </Button>
            </div>
          ))}
        </Card>
      )}

      {/* Danger zone */}
      <div className="rounded-lg border border-danger/30 bg-surface p-5">
        <h3 className="text-sm font-semibold text-danger mb-1">Danger Zone</h3>
        <p className="text-xs text-text-tertiary">
          Deleting an SSH key will revoke access for any system using it. This cannot be undone.
        </p>
      </div>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) handleDelete(deleteId);
          setDeleteId(null);
        }}
        title="Delete SSH Key"
        description="Are you sure? This action cannot be undone."
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </SettingsPage>
  );
}
