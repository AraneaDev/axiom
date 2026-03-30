import { Save, X, Shield } from 'lucide-react';
import { useState } from 'react';

import { webhooksApi, WEBHOOK_EVENTS, type Webhook as WebhookType } from '@/api/webhooks.api';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';

/**
 *
 * @param root0
 * @param root0.repoId
 * @param root0.webhook
 * @param root0.onClose
 */
export function WebhookFormModal({
  repoId,
  webhook,
  onClose,
}: {
  repoId: string;
  webhook: WebhookType | null;
  onClose: () => void;
}) {
  const isEdit = !!webhook;

  const [url, setUrl] = useState(webhook?.url ?? '');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<string[]>(webhook?.events ?? ['push']);
  const [active, setActive] = useState(webhook?.active ?? true);
  const [error, setError] = useState('');

  const mutation = useMutationWithToast(
    () => {
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
    {
      successMessage: isEdit ? 'Webhook updated' : 'Webhook created',
      invalidateKeys: [['webhooks', repoId]],
      onSuccess: () => onClose(),
      onError: (err: Error) => setError(err.message),
    },
  );

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
                <Checkbox
                  checked={events.includes('*') || events.includes(ev.value)}
                  onChange={() => toggleEvent(ev.value)}
                  disabled={ev.value !== '*' && events.includes('*')}
                />
                <span>{ev.label}</span>
              </label>
            ))}
          </div>
        </div>

        {isEdit && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />
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
