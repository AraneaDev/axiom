import { useQuery } from '@tanstack/react-query';
import {
  ScrollText,
  ChevronDown,
  ChevronRight,
  Filter,
  RefreshCw,
  Calendar,
  User,
  Globe,
} from 'lucide-react';
import { useState } from 'react';

import { auditApi, type AuditLogEntry, type AuditLogFilters } from '@/api/audit.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { Table, TableContainer, Tbody, Td, Th, Thead, TrHead } from '@/components/ui/Table';
import { cn } from '@/lib/utils';

const ACTION_OPTIONS = [
  'create',
  'update',
  'delete',
  'login',
  'logout',
  'merge',
  'push',
  'invite',
  'permission_change',
];

const RESOURCE_TYPE_OPTIONS = [
  'user',
  'org',
  'team',
  'project',
  'issue',
  'repo',
  'pull_request',
  'wiki_page',
  'branch_protection',
  'webhook',
  'release',
  'pipeline',
];

const ACTION_VARIANT_MAP: Record<string, 'default' | 'primary' | 'danger' | 'warning' | 'success'> =
  {
    create: 'success',
    update: 'primary',
    delete: 'danger',
    login: 'primary',
    logout: 'default',
    merge: 'success',
    push: 'primary',
    invite: 'warning',
    permission_change: 'warning',
  };

const PAGE_SIZE = 50;

function parseResource(resource: string): { type: string; id?: string } {
  const idx = resource.indexOf(':');
  if (idx === -1) return { type: resource };
  return { type: resource.slice(0, idx), id: resource.slice(idx + 1) };
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function AuditLogRow({ log }: { log: AuditLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const parsed = parseResource(log.resource);
  const details = log.details as Record<string, unknown> | null;
  const ipAddress = details?.ipAddress as string | undefined;

  return (
    <>
      <tr
        className={cn(
          'border-b border-border-light hover:bg-surface-secondary cursor-pointer transition-colors',
          expanded && 'bg-surface-secondary',
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <Td className="text-text-secondary whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-text-tertiary" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-text-tertiary" />
            )}
            <Calendar className="h-3.5 w-3.5 text-text-tertiary" />
            {formatTimestamp(log.createdAt)}
          </span>
        </Td>
        <Td>
          <span className="inline-flex items-center gap-1.5">
            <User className="h-3.5 w-3.5 text-text-tertiary" />
            <span className="text-text font-medium">{log.userId ?? 'system'}</span>
          </span>
        </Td>
        <Td>
          <Badge variant={ACTION_VARIANT_MAP[log.action] ?? 'default'} size="sm">
            {log.action}
          </Badge>
        </Td>
        <Td>
          <Badge variant="outline" size="sm">
            {parsed.type}
          </Badge>
        </Td>
        <Td className="text-text-secondary font-mono text-xs">
          {parsed.id ? parsed.id.slice(0, 12) : '--'}
        </Td>
        <Td className="text-text-tertiary whitespace-nowrap">
          {ipAddress ? (
            <span className="inline-flex items-center gap-1">
              <Globe className="h-3.5 w-3.5" />
              {ipAddress}
            </span>
          ) : (
            '--'
          )}
        </Td>
      </tr>
      {expanded && details && (
        <tr className="bg-surface-tertiary">
          <Td colSpan={6}>
            <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(details, null, 2)}
            </pre>
          </Td>
        </tr>
      )}
    </>
  );
}

/**
 *
 */
export default function AuditLogs() {
  const [filters, setFilters] = useState<AuditLogFilters>({
    limit: PAGE_SIZE,
    offset: 0,
  });
  const [userSearch, setUserSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [resourceTypeFilter, setResourceTypeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const currentFilters: AuditLogFilters = {
    ...filters,
    userId: userSearch || undefined,
    action: actionFilter || undefined,
    resourceType: resourceTypeFilter || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['audit-logs', currentFilters],
    queryFn: () => auditApi.list(currentFilters),
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <ScrollText className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold text-text">Audit Logs</h1>
              <p className="text-sm text-text-secondary">
                Track all changes and access events across the platform
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="bg-surface-elevated border border-border rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-text-tertiary" />
            <span className="text-sm font-medium text-text">Filters</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <Input
                label="User ID"
                placeholder="Filter by user..."
                value={userSearch}
                onChange={(e) => {
                  setUserSearch(e.target.value);
                  setFilters((f) => ({ ...f, offset: 0 }));
                }}
              />
            </div>
            <Select
              label="Action"
              value={actionFilter}
              onChange={(v) => {
                setActionFilter(v as string);
                setFilters((f) => ({ ...f, offset: 0 }));
              }}
              placeholder="All actions"
              options={[
                { value: '', label: 'All actions' },
                ...ACTION_OPTIONS.map((a) => ({ value: a, label: a })),
              ]}
            />
            <Select
              label="Resource Type"
              value={resourceTypeFilter}
              onChange={(v) => {
                setResourceTypeFilter(v as string);
                setFilters((f) => ({ ...f, offset: 0 }));
              }}
              placeholder="All types"
              options={[
                { value: '', label: 'All types' },
                ...RESOURCE_TYPE_OPTIONS.map((r) => ({
                  value: r,
                  label: r.replace(/_/g, ' '),
                })),
              ]}
            />
            <div>
              <Input
                id="start-date"
                type="date"
                label="Start Date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setFilters((f) => ({ ...f, offset: 0 }));
                }}
              />
            </div>
            <div>
              <Input
                id="end-date"
                type="date"
                label="End Date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setFilters((f) => ({ ...f, offset: 0 }));
                }}
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <TableContainer>
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <TrHead>
                  <Th>Timestamp</Th>
                  <Th>User</Th>
                  <Th>Action</Th>
                  <Th>Resource</Th>
                  <Th>ID</Th>
                  <Th>IP Address</Th>
                </TrHead>
              </Thead>
              <Tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="p-4">
                      <TableSkeleton rows={8} cols={6} />
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState
                        icon={<ScrollText />}
                        title="No audit logs found"
                        description="No logs match the current filters. Try adjusting your criteria."
                      />
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => <AuditLogRow key={log.id} log={log} />)
                )}
              </Tbody>
            </Table>
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="px-4 border-t border-border">
              <Pagination
                total={total}
                limit={PAGE_SIZE}
                offset={filters.offset ?? 0}
                onPageChange={(offset) => setFilters((f) => ({ ...f, offset }))}
              />
            </div>
          )}
        </TableContainer>
      </div>
    </div>
  );
}
