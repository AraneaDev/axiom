import { useQuery } from '@tanstack/react-query';
import { Bot, CheckCircle, History, Hourglass, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { agentApprovalsApi, type AgentApprovalSummary } from '@/api/agent-approvals.api';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { Table, TableContainer, Tbody, Td, Th, Thead, TrHead } from '@/components/ui/Table';
import { Tabs } from '@/components/ui/Tabs';
import { effectiveStatus, REFETCH_MS, STATUS_LABELS, STATUS_VARIANTS } from '@/lib/agent-approvals';
import { formatRelative } from '@/lib/utils';

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
              </TrHead>
            </Thead>
            <Tbody>
              {rows.map((row: AgentApprovalSummary) => {
                const status = effectiveStatus(row, now);
                return (
                  <tr key={row.id} className="hover:bg-surface-secondary transition-colors">
                    <Td className="max-w-lg">
                      <Link
                        to={`/approvals/agent/${row.id}`}
                        className="text-primary hover:underline font-medium line-clamp-2 break-words"
                      >
                        {row.preview}
                      </Link>
                      <span className="block text-xs font-mono text-text-tertiary">
                        {row.action}
                      </span>
                    </Td>
                    <Td className="text-sm text-text-secondary">{row.apiTokenName ?? 'Unknown'}</Td>
                    <Td>
                      <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
                    </Td>
                    <Td className="text-sm text-text-tertiary">{formatRelative(row.createdAt)}</Td>
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
