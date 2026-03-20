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
import { Input } from '@/components/ui/Input';
import { TableSkeleton } from '@/components/ui/Skeleton';
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
        <td className="px-4 py-3 text-sm text-text-secondary whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-text-tertiary" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-text-tertiary" />
            )}
            <Calendar className="h-3.5 w-3.5 text-text-tertiary" />
            {formatTimestamp(log.createdAt)}
          </span>
        </td>
        <td className="px-4 py-3 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <User className="h-3.5 w-3.5 text-text-tertiary" />
            <span className="text-text font-medium">{log.userId ?? 'system'}</span>
          </span>
        </td>
        <td className="px-4 py-3">
          <Badge variant={ACTION_VARIANT_MAP[log.action] ?? 'default'} size="sm">
            {log.action}
          </Badge>
        </td>
        <td className="px-4 py-3 text-sm">
          <Badge variant="outline" size="sm">
            {parsed.type}
          </Badge>
        </td>
        <td className="px-4 py-3 text-sm text-text-secondary font-mono text-xs">
          {parsed.id ? parsed.id.slice(0, 12) : '--'}
        </td>
        <td className="px-4 py-3 text-sm text-text-tertiary whitespace-nowrap">
          {ipAddress ? (
            <span className="inline-flex items-center gap-1">
              <Globe className="h-3.5 w-3.5" />
              {ipAddress}
            </span>
          ) : (
            '--'
          )}
        </td>
      </tr>
      {expanded && details && (
        <tr className="border-b border-border-light bg-surface-tertiary">
          <td colSpan={6} className="px-4 py-3">
            <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(details, null, 2)}
            </pre>
          </td>
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
  const currentPage = Math.floor((filters.offset ?? 0) / PAGE_SIZE);
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function goToPage(page: number) {
    setFilters((f) => ({ ...f, offset: page * PAGE_SIZE }));
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <ScrollText className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-semibold text-text">Audit Logs</h1>
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
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Start Date
              </label>
              <input
                type="date"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-border-focus focus:outline-none"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setFilters((f) => ({ ...f, offset: 0 }));
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">End Date</label>
              <input
                type="date"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-border-focus focus:outline-none"
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
        <div className="bg-surface-elevated border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-secondary">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">
                    Timestamp
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">
                    Action
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">
                    Resource
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">
                    ID
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">
                    IP Address
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="p-4">
                      <TableSkeleton rows={8} cols={6} />
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-text-tertiary text-sm">
                      No audit logs found matching the current filters.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => <AuditLogRow key={log.id} log={log} />)
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <span className="text-sm text-text-secondary">
                Showing {(filters.offset ?? 0) + 1}--
                {Math.min((filters.offset ?? 0) + PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 0}
                  onClick={() => goToPage(currentPage - 1)}
                >
                  <ChevronRight className="h-4 w-4 rotate-180" /> Prev
                </Button>
                <span className="text-sm text-text-secondary">
                  Page {currentPage + 1} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => goToPage(currentPage + 1)}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
