import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Bot, Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import { agentApprovalsApi, type AgentApproval } from '@/api/agent-approvals.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CopyInput } from '@/components/ui/CopyInput';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import {
  effectiveStatus,
  REFETCH_MS,
  secretTokenOf,
  STATUS_LABELS,
  STATUS_VARIANTS,
} from '@/lib/agent-approvals';
import { formatDate } from '@/lib/utils';

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
  const [showInput, setShowInput] = useState(false);
  // The decision's own answer: only it holds a secret (a new token), and it is never refetched
  const [decided, setDecided] = useState<AgentApproval | null>(null);
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
    onSuccess: (row: AgentApproval) => setDecided(row),
  };
  const approve = useMutationWithToast(() => agentApprovalsApi.approve(id), {
    ...options,
    successMessage: 'Approved',
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

  const row = decided ?? data;
  const status = effectiveStatus(row, now);
  // An invitation's result has a token too, which is no API token to hand over
  const secret = data?.action === 'token.create' ? secretTokenOf(decided?.result) : null;
  const decisionError = approve.error ?? reject.error;
  const open = status === 'PENDING';
  const busy = approve.isPending || reject.isPending;

  return (
    <div className="max-w-4xl">
      <Link
        to="/approvals/agent"
        className="mb-3 inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Agent approvals
      </Link>
      <PageHeader title="Approval request">
        <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
      </PageHeader>

      <Card className="p-5 mb-4">
        <p className="mb-3 whitespace-pre-wrap break-words text-base font-medium text-text">
          {row.preview}
        </p>
        <dl className="divide-y divide-border-light">
          <Field label="Who">
            <span className="inline-flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5 text-text-secondary" />
              You, through the token {row.apiTokenName ?? 'unknown'}
            </span>
          </Field>
          <Field label="Action">
            <span className="font-mono text-xs">{row.action}</span>
          </Field>
          <Field label="Asked">{formatDate(row.createdAt)}</Field>
          <Field label={open ? 'Expires' : 'Expired'}>{formatDate(row.expiresAt)}</Field>
          {row.decidedAt && <Field label="Decided">{formatDate(row.decidedAt)}</Field>}
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

      {decisionError && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-danger/20 bg-danger-light px-3 py-2 text-sm text-danger"
        >
          {decisionError.message || 'Could not record your decision'}
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
            Token created. Copy it now and hand it to the agent yourself: it is not stored and you
            will not see it again.
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
              value={secret ? { ...(row.result as object), token: '[shown above]' } : row.result}
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
  );
}
