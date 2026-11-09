import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Lock,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import { agentApprovalsApi, type AgentApproval } from '@/api/agent-approvals.api';
import { serviceAccountError } from '@/api/service-accounts.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CopyInput } from '@/components/ui/CopyInput';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import {
  effectiveStatus,
  REFETCH_MS,
  secretTokenOf,
  STATUS_LABELS,
  STATUS_VARIANTS,
  timeLeft,
} from '@/lib/agent-approvals';
import { formatTimestamp } from '@/lib/format';

import { BotLine } from './BotLine';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-2">
      <dt className="text-xs font-medium uppercase tracking-wide text-text-tertiary">{label}</dt>
      <dd className="text-sm text-text min-w-0">{children}</dd>
    </div>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-md bg-surface-tertiary p-3 text-xs font-mono text-text">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/**
 * One request from an agent: who asked, what it would do, the exact input, and the decision.
 * The preview is text built by the server and shows as plain text.
 */
export default function AgentApprovalDetail() {
  const { id = '' } = useParams();
  // Keyed by the request, so a decision, an error or the input panel of one never shows on the next
  return <AgentApprovalDetailFor key={id} id={id} />;
}

function AgentApprovalDetailFor({ id }: { id: string }) {
  const [showInput, setShowInput] = useState(false);
  // The decision's own answer: only it holds a secret (a new token), and it is never refetched
  const [decided, setDecided] = useState<AgentApproval | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['agent-approvals', 'detail', id],
    queryFn: () => agentApprovalsApi.get(id),
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
    enabled: id !== '',
  });

  const options = {
    invalidateKeys: [['agent-approvals'], ['notifications']],
    // The answer holds a new token once: keep it out of the mutation cache after unmount
    gcTime: 0,
    onSuccess: (row: AgentApproval) => setDecided(row),
    // Another decision got there first (409): show the row as it is now, not a red error
    onError: (error: Error) => {
      if ((error as { status?: number }).status === 409) {
        void queryClient.invalidateQueries({ queryKey: ['agent-approvals'] });
      }
    },
  };
  const approve = useMutationWithToast(() => agentApprovalsApi.approve(id), {
    ...options,
    // The message follows the outcome: an approved run can still have failed
    successMessage: null,
    onSuccess: (row: AgentApproval) => {
      setDecided(row);
      if (row.status === 'FAILED') toast.error('Approved, but the action failed');
      else toast.success('Approved');
    },
    errorMessage: null,
  });
  const reject = useMutationWithToast(() => agentApprovalsApi.reject(id), {
    ...options,
    successMessage: 'Request rejected',
    errorMessage: null,
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error || !data) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Request not found"
        description="It does not exist, or it is not yours."
      />
    );
  }

  // The decision's answer belongs to the request it was made on, not to the next one opened
  const mine = decided?.id === id ? decided : null;
  const row = mine ?? data;
  const status = effectiveStatus(row, now);
  // An invitation's result has a token too, which is no API token to hand over
  const secret = data?.action === 'token.create' ? secretTokenOf(mine?.result) : null;
  const failed = approve.error ?? reject.error;
  const decisionError = (failed as { status?: number } | null)?.status === 409 ? null : failed;
  const open = status === 'PENDING';
  const busy = approve.isPending || reject.isPending;

  return (
    <div>
      <Link
        to="/approvals/agent"
        className="mb-3 inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Agent approvals
      </Link>
      <PageHeader title="Approval request">
        <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <aside className="order-last mb-4 lg:order-none lg:col-start-2 lg:row-start-1">
          <Card className="p-5">
            <dl className="divide-y divide-border-light">
              <Field label="Who">
                {row.serviceAccount ? (
                  <>
                    <BotLine bot={row.serviceAccount} />
                    <span className="block text-xs text-text-tertiary">
                      Through its token {row.apiTokenName ?? 'unknown'}
                    </span>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Bot className="h-3.5 w-3.5 text-text-secondary" />
                    You, through the token {row.apiTokenName ?? 'unknown'}
                  </span>
                )}
              </Field>
              <Field label="Action">
                <span className="font-mono text-xs">{row.action}</span>
              </Field>
              <Field label="Asked">{formatTimestamp(row.createdAt)}</Field>
              {(open || status === 'EXPIRED') && (
                <Field label={open ? 'Expires' : 'Expired'}>
                  {formatTimestamp(row.expiresAt)}
                  {open && (
                    <span className="ml-2 text-text-secondary">{timeLeft(row.expiresAt, now)}</span>
                  )}
                </Field>
              )}
              {row.decidedAt && <Field label="Decided">{formatTimestamp(row.decidedAt)}</Field>}
            </dl>
          </Card>
        </aside>
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          {row.restricted ? (
            // A stub: the bot asked in a place this owner can't open, so there is nothing to read
            // and nothing for them to decide
            <Card className="p-5 mb-4">
              <p className="inline-flex items-center gap-1.5 text-base font-medium text-text-secondary">
                <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />A request in a place you
                can&apos;t open
              </p>
              <p className="mt-2 text-sm text-text-secondary">
                An owner of this bot who can open that place decides it.
              </p>
            </Card>
          ) : (
            <>
              <Card className="p-5 mb-4">
                <p className="mb-3 whitespace-pre-wrap break-words text-base font-medium text-text">
                  {row.preview}
                </p>
                <dl className="divide-y divide-border-light">
                  <Field label="Exact input">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setShowInput(!showInput)}
                      aria-expanded={showInput}
                    >
                      {showInput ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      {showInput ? 'Hide input' : 'Show input'}
                    </Button>
                    {showInput && <Json value={row.input} />}
                  </Field>
                </dl>
              </Card>
              {open && (
                <div className="flex items-center gap-2 mb-4">
                  <Button onClick={() => approve.mutate()} disabled={busy}>
                    {approve.isPending ? <Spinner size="sm" /> : <Check className="h-4 w-4" />}
                    Approve
                  </Button>
                  <Button variant="outline" onClick={() => reject.mutate()} disabled={busy}>
                    {reject.isPending ? <Spinner size="sm" /> : <X className="h-4 w-4" />}
                    Reject
                  </Button>
                </div>
              )}
            </>
          )}

          {decisionError && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-danger/20 bg-danger-light px-3 py-2 text-sm text-danger"
            >
              {serviceAccountError(decisionError, 'Could not record your decision')}
            </div>
          )}

          {status === 'EXPIRED' && (
            <p className="mb-4 text-sm text-text-secondary">
              This request expired before you decided. The agent has to ask again.
            </p>
          )}
          {status === 'REJECTED' && (
            <p className="mb-4 text-sm text-text-secondary">
              You rejected this request. The action never ran.
            </p>
          )}

          {secret && (
            <div className="mb-4 rounded-lg border border-success/20 bg-success-light p-4">
              <p className="mb-2 text-sm font-medium text-success">
                Token created. Copy it now and hand it to the agent yourself: it is not stored and
                you will not see it again.
              </p>
              <CopyInput value={secret} label="New token" />
            </div>
          )}

          {status === 'EXECUTED' && (
            <Card className="p-5 mb-4">
              <h2 className="mb-2 text-sm font-semibold text-text">Result</h2>
              {row.result == null ? (
                <p className="text-sm text-text-secondary">The action ran and returned nothing.</p>
              ) : (
                <Json
                  value={
                    secret ? { ...(row.result as object), token: '[shown above]' } : row.result
                  }
                />
              )}
            </Card>
          )}

          {status === 'FAILED' && (
            <Card className="p-5 mb-4 border-danger/30">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-danger">
                <AlertTriangle className="h-4 w-4" /> The action failed
              </h2>
              <p className="text-sm text-text">
                {row.error?.message ?? 'The action failed without a message.'}
              </p>
              {row.error?.code && (
                <p className="mt-1 text-xs font-mono text-text-tertiary">{row.error.code}</p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
