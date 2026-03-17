import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Key, Plus, Trash2 } from 'lucide-react';
import { usersApi } from '@/api/users.api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner, PageLoader } from '@/components/ui/Spinner';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { formatDate } from '@/lib/utils';

export default function SshKeys() {
  const queryClient = useQueryClient();
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
    },
    onError: (err: any) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (keyId: string) => usersApi.deleteSshKey(keyId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sshKeys'] }),
  });

  function handleDelete(keyId: string) {
    deleteMutation.mutate(keyId);
  }

  if (isLoading) return <PageLoader />;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">SSH Keys</h1>
        <Button size="sm" onClick={() => setShowForm(!showForm)}><Plus className="h-4 w-4" /> Add Key</Button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-border bg-surface p-4 mb-6">
          {error && <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-danger">{error}</div>}
          <div className="space-y-3">
            <Input id="keyTitle" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My laptop" />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-text">Public key</label>
              <textarea value={publicKey} onChange={(e) => setPublicKey(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs font-mono placeholder:text-text-secondary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                rows={4} placeholder="ssh-ed25519 AAAA..." />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !title || !publicKey}>
                {addMutation.isPending ? <Spinner className="h-4 w-4" /> : 'Add key'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {!keys?.length ? (
        <EmptyState icon={<Key className="h-10 w-10" />} title="No SSH keys" description="Add an SSH key to clone repos over SSH." />
      ) : (
        <div className="rounded-lg border border-border bg-surface divide-y divide-border">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center gap-3 p-4">
              <Key className="h-4 w-4 text-text-secondary" />
              <div className="flex-1">
                <p className="text-sm font-medium">{k.title}</p>
                <p className="text-xs text-text-secondary font-mono">{k.fingerprint}</p>
              </div>
              <span className="text-xs text-text-secondary">Added {formatDate(k.createdAt)}</span>
              <Button variant="ghost" size="sm" onClick={() => setDeleteId(k.id)}>
                <Trash2 className="h-3.5 w-3.5 text-danger" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Confirm Delete" size="sm">
        <p className="text-sm text-text-secondary">Are you sure? This action cannot be undone.</p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteId(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { handleDelete(deleteId!); setDeleteId(null); }}>Delete</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
