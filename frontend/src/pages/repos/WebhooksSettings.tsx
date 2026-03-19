import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Trash2,
  Pencil,
  Webhook,
  Globe,
  Shield,
  ToggleLeft,
  ToggleRight,
  Save,
  X,
} from 'lucide-react';
import { useState } from 'react';

import { webhooksApi, WEBHOOK_EVENTS, type Webhook as WebhookType } from '@/api/webhooks.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';

interface WebhooksSettingsProps {
  repoId: string;
}

/**
 *
 * @param root0
 * @param root0.repoId
 */
export default function WebhooksSettings({ repoId }: WebhooksSettingsProps) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WebhookType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookType | null>(null);

  const { data: webhooks = [], isLoading } = useQuery({
    queryKey: ['webhooks', repoId],
    queryFn: () => webhooksApi.list(repoId),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      webhooksApi.update(repoId, id, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['webhooks', repoId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => webhooksApi.delete(repoId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', repoId] });
      setDeleteTarget(null);
    },
  });

  const handleEdit = (webhook: WebhookType) => {
    setEditing(webhook);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Webhook className="h-5 w-5" /> Webhooks
        </h2>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4" /> Add webhook
        </Button>
      </div>

      <p className="text-sm text-text-secondary mb-4">
        Webhooks notify external services when events happen in this repository.
      </p>

      {isLoading && <p className="text-sm text-text-tertiary py-4">Loading webhooks...</p>}

      {!isLoading && webhooks.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <Webhook className="h-8 w-8 text-text-tertiary mx-auto mb-2" />
          <p className="text-sm text-text-secondary">No webhooks configured yet.</p>
          <p className="text-xs text-text-tertiary mt-1">
            Add a webhook to notify external services of repository events.
          </p>
        </div>
      )}

      {webhooks.length > 0 && (
        <div className="rounded-lg border border-border bg-surface divide-y divide-border">
          {webhooks.map((wh) => (
            <div key={wh.id} className="flex items-center gap-3 px-4 py-3">
              <button
                onClick={() => toggleMutation.mutate({ id: wh.id, active: !wh.active })}
                className="shrink-0 text-text-secondary hover:text-text transition-colors"
                title={wh.active ? 'Deactivate webhook' : 'Activate webhook'}
              >
                {wh.active ? (
                  <ToggleRight className="h-5 w-5 text-success" />
                ) : (
                  <ToggleLeft className="h-5 w-5 text-text-tertiary" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
                  <span className="text-sm font-mono truncate">{wh.url}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {wh.events.map((ev) => (
                    <Badge key={ev} variant="outline" size="sm">
                      {WEBHOOK_EVENTS.find((e) => e.value === ev)?.label ?? ev}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => handleEdit(wh)}
                  title="Edit webhook"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setDeleteTarget(wh)}
                  title="Delete webhook"
                >
                  <Trash2 className="h-3.5 w-3.5 text-danger" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit form modal */}
      {showForm && <WebhookFormModal repoId={repoId} webhook={editing} onClose={handleCloseForm} />}

      {/* Delete confirmation modal */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete webhook"
        size="sm"
      >
        <p className="text-sm text-text-secondary">
          Are you sure you want to delete the webhook for{' '}
          <span className="font-mono text-text">{deleteTarget?.url}</span>? This cannot be undone.
        </p>
        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="h-4 w-4" /> {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

/* ─── Form Modal ──────────────────────────────────────────── */

function WebhookFormModal({
  repoId,
  webhook,
  onClose,
}: {
  repoId: string;
  webhook: WebhookType | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!webhook;

  const [url, setUrl] = useState(webhook?.url ?? '');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<string[]>(webhook?.events ?? ['push']);
  const [active, setActive] = useState(webhook?.active ?? true);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      if (isEdit) {
        return webhooksApi.update(repoId, webhook.id, {
          url,
          secret: secret || undefined,
          events,
          active,
        });
      }
      return webhooksApi.create(repoId, { url, secret: secret || undefined, events });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', repoId] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const toggleEvent = (value: string) => {
    if (value === '*') {
      setEvents(events.includes('*') ? ['push'] : ['*']);
      return;
    }
    // Remove wildcard when selecting individual events
    const without = events.filter((e) => e !== '*');
    if (without.includes(value)) {
      const next = without.filter((e) => e !== value);
      setEvents(next.length ? next : ['push']);
    } else {
      setEvents([...without, value]);
    }
  };

  const handleSubmit = () => {
    if (!url.trim()) {
      setError('URL is required');
      return;
    }
    try {
      new URL(url);
    } catch {
      setError('Please enter a valid URL');
      return;
    }
    if (events.length === 0) {
      setError('Select at least one event');
      return;
    }
    setError('');
    mutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit webhook' : 'Add webhook'} size="md">
      <div className="space-y-4">
        <Input
          label="Payload URL"
          placeholder="https://example.com/webhook"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />

        <Input
          label="Secret"
          placeholder="Optional HMAC secret for signature verification"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          hint={isEdit ? 'Leave blank to keep the existing secret' : undefined}
        />

        <div>
          <label className="block text-sm font-medium text-text mb-2">Events</label>
          <div className="grid grid-cols-2 gap-2">
            {WEBHOOK_EVENTS.map((ev) => (
              <label
                key={ev.value}
                className="flex items-center gap-2 px-3 py-2 rounded-md border border-border hover:bg-surface-secondary cursor-pointer transition-colors text-sm"
              >
                <input
                  type="checkbox"
                  checked={events.includes('*') || events.includes(ev.value)}
                  onChange={() => toggleEvent(ev.value)}
                  disabled={ev.value !== '*' && events.includes('*')}
                  className="rounded border-border text-primary focus:ring-primary"
                />
                <span>{ev.label}</span>
              </label>
            ))}
          </div>
        </div>

        {isEdit && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="rounded border-border text-primary focus:ring-primary"
            />
            <span>Active</span>
            <Shield className="h-3.5 w-3.5 text-text-tertiary" />
          </label>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>

      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>
          <X className="h-4 w-4" /> Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={mutation.isPending}>
          <Save className="h-4 w-4" />{' '}
          {mutation.isPending ? 'Saving...' : isEdit ? 'Update webhook' : 'Create webhook'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
