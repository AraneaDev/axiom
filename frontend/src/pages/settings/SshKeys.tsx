import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Key, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { usersApi } from '@/api/users.api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Skeleton, ListSkeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/utils';

/**
 *
 */
export default function SshKeys() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: keys, isLoading } = useQuery({
    queryKey: ['sshKeys'],
    queryFn: usersApi.listSshKeys,
  });

  const addMutation = useMutation({
    mutationFn: () => usersApi.addSshKey({ title, publicKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sshKeys'] });
      setShowForm(false);
      setTitle('');
      setPublicKey('');
      toast.success('SSH key added');
    },
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : 'Failed to add SSH key'),
  });

  const deleteMutation = useMutation({
    mutationFn: (keyId: string) => usersApi.deleteSshKey(keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sshKeys'] });
      toast.success('SSH key deleted');
    },
  });

  function handleDelete(keyId: string) {
    deleteMutation.mutate(keyId);
  }

  if (isLoading)
    return (
      <div className="max-w-3xl mx-auto space-y-6">
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

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">SSH Keys</h1>
          <p className="text-sm text-text-tertiary mt-1">
            Manage SSH keys for authenticating with git over SSH
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4" /> Add Key
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold text-text mb-4">Add new SSH key</h3>
          {error && (
            <div className="mb-4 rounded-lg bg-danger-light border border-danger/20 px-4 py-2.5 text-sm text-danger">
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
                  <Spinner className="h-4 w-4" />
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
        </div>
      )}

      {!keys?.length ? (
        <EmptyState
          icon={<Key className="h-10 w-10" />}
          title="No SSH keys"
          description="Add an SSH key to clone repos over SSH."
        />
      ) : (
        <div className="rounded-xl border border-border bg-surface divide-y divide-border">
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
        </div>
      )}

      {/* Danger zone */}
      <div className="rounded-xl border border-danger/30 bg-surface p-5">
        <h3 className="text-sm font-semibold text-danger mb-1">Danger Zone</h3>
        <p className="text-xs text-text-tertiary">
          Deleting an SSH key will revoke access for any system using it. This cannot be undone.
        </p>
      </div>

      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Confirm Delete" size="sm">
        <p className="text-sm text-text-secondary">Are you sure? This action cannot be undone.</p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteId(null)}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              handleDelete(deleteId!);
              setDeleteId(null);
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
