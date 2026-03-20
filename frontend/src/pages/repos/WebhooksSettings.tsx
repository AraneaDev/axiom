import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Trash2,
  Pencil,
  Webhook,
  Globe,
  ToggleLeft,
  ToggleRight,
  X,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';

import { WebhookDeliveriesPanel } from './WebhookDeliveries';
import { WebhookFormModal } from './WebhookForm';

import { webhooksApi, WEBHOOK_EVENTS, type Webhook as WebhookType } from '@/api/webhooks.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

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
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WebhookType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookType | null>(null);
  const [expandedDeliveries, setExpandedDeliveries] = useState<string | null>(null);

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
      toast.success('Webhook deleted');
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

      {isLoading && <ListSkeleton rows={3} />}

      {!isLoading && webhooks.length === 0 && (
        <EmptyState
          icon={<Webhook />}
          title="No webhooks configured"
          description="Add a webhook to notify external services of repository events."
          action={
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" /> Add webhook
            </Button>
          }
        />
      )}

      {webhooks.length > 0 && (
        <div className="rounded-lg border border-border bg-surface divide-y divide-border">
          {webhooks.map((wh) => (
            <div key={wh.id}>
              <div className="flex items-center gap-3 px-4 py-3">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => toggleMutation.mutate({ id: wh.id, active: !wh.active })}
                  className="shrink-0"
                  title={wh.active ? 'Deactivate webhook' : 'Activate webhook'}
                >
                  {wh.active ? (
                    <ToggleRight className="h-5 w-5 text-success" />
                  ) : (
                    <ToggleLeft className="h-5 w-5 text-text-tertiary" />
                  )}
                </Button>

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
                    onClick={() =>
                      setExpandedDeliveries(expandedDeliveries === wh.id ? null : wh.id)
                    }
                    title="Recent deliveries"
                  >
                    {expandedDeliveries === wh.id ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </Button>
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

              {expandedDeliveries === wh.id && (
                <WebhookDeliveriesPanel repoId={repoId} webhookId={wh.id} />
              )}
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
