import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Webhook, Globe, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { WebhookDeliveriesPanel } from './WebhookDeliveries';
import { WebhookFormModal } from './WebhookForm';

import { webhooksApi, WEBHOOK_EVENTS, type Webhook as WebhookType } from '@/api/webhooks.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { Toggle } from '@/components/ui/Toggle';
import { useModalState } from '@/hooks/useModalState';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';

interface WebhooksSettingsProps {
  repoId: string;
}

/**
 *
 * @param root0
 * @param root0.repoId
 */
export default function WebhooksSettings({ repoId }: WebhooksSettingsProps) {
  const formModal = useModalState();
  const [editing, setEditing] = useState<WebhookType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookType | null>(null);
  const [expandedDeliveries, setExpandedDeliveries] = useState<string | null>(null);

  const { data: webhooks = [], isLoading } = useQuery({
    queryKey: ['webhooks', repoId],
    queryFn: () => webhooksApi.list(repoId),
  });

  const toggleMutation = useMutationWithToast(
    ({ id, active }: { id: string; active: boolean }) => webhooksApi.update(repoId, id, { active }),
    {
      successMessage: null,
      errorMessage: null,
      invalidateKeys: [['webhooks', repoId]],
    },
  );

  const deleteMutation = useMutationWithToast((id: string) => webhooksApi.delete(repoId, id), {
    successMessage: 'Webhook deleted',
    invalidateKeys: [['webhooks', repoId]],
    onSuccess: () => setDeleteTarget(null),
  });

  const handleEdit = (webhook: WebhookType) => {
    setEditing(webhook);
    formModal.open();
  };

  const handleCloseForm = () => {
    formModal.close();
    setEditing(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="h3 flex items-center gap-2">
          <Webhook className="h-5 w-5" /> Webhooks
        </h2>
        <Button size="sm" onClick={() => formModal.open()}>
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
            <Button size="sm" onClick={() => formModal.open()}>
              <Plus className="h-4 w-4" /> Add webhook
            </Button>
          }
        />
      )}

      {webhooks.length > 0 && (
        <Card className="divide-y divide-border">
          {webhooks.map((wh) => (
            <div key={wh.id}>
              <div className="flex items-center gap-3 px-4 py-3">
                <Toggle
                  checked={wh.active}
                  onChange={(val) => toggleMutation.mutate({ id: wh.id, active: val })}
                  size="sm"
                />

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
        </Card>
      )}

      {/* Create / Edit form modal */}
      {formModal.isOpen && (
        <WebhookFormModal repoId={repoId} webhook={editing} onClose={handleCloseForm} />
      )}

      {/* Delete confirmation modal */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Delete webhook"
        description={`Are you sure you want to delete the webhook for ${deleteTarget?.url}? This cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
