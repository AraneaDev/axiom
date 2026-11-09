import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle,
  History,
  Hourglass,
  Lock,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { agentApprovalsApi, type AgentApprovalSummary } from '@/api/agent-approvals.api';
import { serviceAccountError } from '@/api/service-accounts.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { Table, TableContainer, Tbody, Td, Th, Thead, TrHead } from '@/components/ui/Table';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import {
  effectiveStatus,
  REFETCH_MS,
  SECRET_RESULT_ACTIONS,
  STATUS_LABELS,
  STATUS_VARIANTS,
} from '@/lib/agent-approvals';
import { formatRelative } from '@/lib/utils';

import { BotLine } from './BotLine';

type Tab = 'pending' | 'history';

const HISTORY_PAGE = 25;

const TABS = [
  { key: 'pending', label: 'Pending', icon: <Hourglass className="h-4 w-4" /> },
  { key: 'history', label: 'History', icon: <History className="h-4 w-4" /> },
];

/**
 * The requests that agents made on your behalf, waiting for you or decided. Not the issue
 * approval gates: those are on My Approvals.
 */
export default function AgentApprovals() {
  const [tab, setTab] = useState<Tab>('pending');
  const [offset, setOffset] = useState(0);
  // Expiry sends no event: the clock moves the rows, and the refetch confirms them
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['agent-approvals', 'list', tab, tab === 'history' ? offset : 0],
    queryFn: () =>
      tab === 'pending'
        ? agentApprovalsApi.list({ status: 'PENDING' })
        : agentApprovalsApi.list({ state: 'decided', limit: HISTORY_PAGE, offset }),
    // Paging keeps the rows on screen; the other tab does not borrow this tab's rows
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === tab ? previous : undefined,
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
  });

  const queryClient = useQueryClient();
  const toast = useToast();
  // A decision from the list: the row leaves the pending tab once the list is read again
  const decide = useMutationWithToast(
    ({ id, approve }: { id: string; approve: boolean }) =>
      approve ? agentApprovalsApi.approve(id) : agentApprovalsApi.reject(id),
    {
      successMessage: null,
      errorMessage: null,
      // An answer is never kept: it may hold what a run returned
      gcTime: 0,
      onSuccess: (row) => {
        if (row.status === 'FAILED') toast.error('Approved, but the action failed');
        else toast.success(row.status === 'REJECTED' ? 'Request rejected' : 'Approved');
        void queryClient.invalidateQueries({ queryKey: ['agent-approvals'] });
      },
      // Decided elsewhere or gone meanwhile: the list read again shows what holds now
      onError: () => void queryClient.invalidateQueries({ queryKey: ['agent-approvals'] }),
    },
  );

  // Decided elsewhere meanwhile (409): no error, the list read again shows the outcome
  const decisionError =
    (decide.error as { status?: number } | null)?.status === 409 ? null : decide.error;

  const rows = (data?.data ?? []).filter((row) =>
    tab === 'pending'
      ? effectiveStatus(row, now) === 'PENDING'
      : effectiveStatus(row, now) !== 'PENDING',
  );

  return (
    <div>
      <PageHeader title="Agent approvals">
        <Bot className="h-5 w-5 text-text-secondary" />
      </PageHeader>
      <p className="mb-4 text-sm text-text-secondary">
        Actions that an agent asked to run with your rights. Nothing runs until you approve it here.
      </p>
      <Tabs
        tabs={TABS}
        activeKey={tab}
        onChange={(key) => {
          setTab(key as Tab);
          setOffset(0);
        }}
        className="mb-4"
      />

      {decisionError && (
        <div className="mb-4">
          <ErrorAlert error={new Error(serviceAccountError(decisionError))} fallback="" />
        </div>
      )}

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <EmptyState
          icon={<XCircle />}
          title="Failed to load agent approvals"
          description="Something went wrong loading the requests."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          card
          icon={<CheckCircle className="h-10 w-10" />}
          title={tab === 'pending' ? 'Nothing waits for you' : 'No decided requests yet'}
          description={
            tab === 'pending'
              ? 'When an agent needs your approval, the request shows up here.'
              : 'Requests you approved, rejected or let expire show up here.'
          }
        />
      ) : (
        <TableContainer>
          <Table>
            <Thead>
              <TrHead>
                <Th>Request</Th>
                <Th>Token</Th>
                <Th>Status</Th>
                <Th>Asked</Th>
                {tab === 'pending' && <Th>Decide</Th>}
              </TrHead>
            </Thead>
            <Tbody>
              {rows.map((row: AgentApprovalSummary) => {
                const status = effectiveStatus(row, now);
                return (
                  <tr key={row.id} className="hover:bg-surface-secondary transition-colors">
                    <Td className="max-w-lg">
                      {row.restricted ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-text-secondary">
                          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />A request in a
                          place you can&apos;t open
                        </span>
                      ) : (
                        <Link
                          to={`/approvals/agent/${row.id}`}
                          className="text-primary hover:underline font-medium line-clamp-2 break-words"
                        >
                          {row.preview}
                        </Link>
                      )}
                      <span className="block text-xs font-mono text-text-tertiary">
                        {row.action}
                      </span>
                      {row.serviceAccount && <BotLine bot={row.serviceAccount} />}
                    </Td>
                    <Td className="text-sm text-text-secondary">{row.apiTokenName ?? 'Unknown'}</Td>
                    <Td>
                      <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
                    </Td>
                    <Td className="text-sm text-text-tertiary">{formatRelative(row.createdAt)}</Td>
                    {tab === 'pending' && (
                      <Td>
                        {/* A stub is decided by an owner who can open its place, never here */}
                        {!row.restricted &&
                          status === 'PENDING' &&
                          SECRET_RESULT_ACTIONS.has(row.action) && (
                            // Its secret shows once, to whoever approves it on its own page
                            <ButtonLink
                              to={`/approvals/agent/${row.id}`}
                              size="xs"
                              variant="secondary"
                            >
                              <ArrowRight className="h-3.5 w-3.5" /> Open
                            </ButtonLink>
                          )}
                        {!row.restricted &&
                          status === 'PENDING' &&
                          !SECRET_RESULT_ACTIONS.has(row.action) && (
                            <div className="flex gap-1">
                              <Button
                                size="xs"
                                disabled={decide.isPending}
                                onClick={() => decide.mutate({ id: row.id, approve: true })}
                              >
                                <Check className="h-3.5 w-3.5" /> Approve
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={decide.isPending}
                                onClick={() => decide.mutate({ id: row.id, approve: false })}
                              >
                                <X className="h-3.5 w-3.5" /> Reject
                              </Button>
                            </div>
                          )}
                      </Td>
                    )}
                  </tr>
                );
              })}
            </Tbody>
          </Table>
        </TableContainer>
      )}
      {tab === 'history' && (data?.total ?? 0) > HISTORY_PAGE && (
        <Pagination
          className="mt-3"
          total={data?.total ?? 0}
          limit={HISTORY_PAGE}
          offset={offset}
          onPageChange={setOffset}
        />
      )}
    </div>
  );
}
