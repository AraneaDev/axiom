import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Clock, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';

import { webhooksApi, type WebhookDelivery } from '@/api/webhooks.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

/**
 *
 * @param root0
 * @param root0.repoId
 * @param root0.webhookId
 */
export function WebhookDeliveriesPanel({
  repoId,
  webhookId,
}: {
  repoId: string;
  webhookId: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: deliveries = [], isLoading } = useQuery({
    queryKey: ['webhook-deliveries', webhookId],
    queryFn: () => webhooksApi.listDeliveries(repoId, webhookId),
  });

  const redeliverMutation = useMutation({
    mutationFn: (deliveryId: string) => webhooksApi.redeliver(repoId, webhookId, deliveryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhook-deliveries', webhookId] });
      toast.success('Webhook redelivered');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="px-4 pb-3">
        <ListSkeleton rows={3} />
      </div>
    );
  }

  if (deliveries.length === 0) {
    return (
      <div className="px-4 pb-3">
        <p className="text-xs text-text-tertiary py-3 text-center">No deliveries yet.</p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-3">
      <p className="text-xs font-medium text-text-secondary mb-2">Recent Deliveries</p>
      <div className="rounded-md border border-border-light divide-y divide-border-light bg-surface-secondary">
        {deliveries.map((d: WebhookDelivery) => (
          <div key={d.id}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
              className="w-full justify-start rounded-none px-3 py-2"
            >
              {d.success ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-danger shrink-0" />
              )}
              <span className="text-xs font-mono text-text-secondary truncate flex-1">
                {d.event}
              </span>
              {d.statusCode != null && (
                <Badge
                  variant={d.statusCode >= 200 && d.statusCode < 300 ? 'success' : 'danger'}
                  size="sm"
                >
                  {d.statusCode}
                </Badge>
              )}
              {d.statusCode == null && d.error && (
                <Badge variant="danger" size="sm">
                  Error
                </Badge>
              )}
              <span className="text-xs text-text-tertiary flex items-center gap-1 shrink-0">
                <Clock className="h-3 w-3" /> {d.duration}ms
              </span>
              <span className="text-xs text-text-tertiary shrink-0">
                {new Date(d.createdAt).toLocaleString()}
              </span>
              {expandedId === d.id ? (
                <ChevronDown className="h-3 w-3 text-text-tertiary shrink-0" />
              ) : (
                <ChevronRight className="h-3 w-3 text-text-tertiary shrink-0" />
              )}
            </Button>

            {expandedId === d.id && (
              <div className="px-3 pb-3 space-y-2">
                {d.error && (
                  <div className="text-xs text-danger bg-danger-light rounded px-2 py-1">
                    {d.error}
                  </div>
                )}
                {d.requestBody && (
                  <div>
                    <p className="text-xs font-medium text-text-secondary mb-1">Request Body</p>
                    <pre className="text-xs font-mono bg-surface rounded border border-border-light p-2 overflow-x-auto max-h-40">
                      {formatJson(d.requestBody)}
                    </pre>
                  </div>
                )}
                {d.responseBody && (
                  <div>
                    <p className="text-xs font-medium text-text-secondary mb-1">Response Body</p>
                    <pre className="text-xs font-mono bg-surface rounded border border-border-light p-2 overflow-x-auto max-h-40">
                      {formatJson(d.responseBody)}
                    </pre>
                  </div>
                )}
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => redeliverMutation.mutate(d.id)}
                    disabled={redeliverMutation.isPending}
                  >
                    <RefreshCw className="h-3 w-3" />{' '}
                    {redeliverMutation.isPending ? 'Sending...' : 'Redeliver'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
