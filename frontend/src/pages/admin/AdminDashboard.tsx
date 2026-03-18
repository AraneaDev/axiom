import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import {
  Users,
  Building2,
  GitFork,
  CircleDot,
  FileText,
  HardDrive,
  Settings,
  UserCog,
} from 'lucide-react';
import { Link } from 'react-router';

import { adminApi } from '@/api/admin.api';
import type { SystemStats } from '@/api/admin.api';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';

// ─── Helpers ────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ─── Stat Card ──────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface p-5 flex items-start gap-4',
        className,
      )}
    >
      <div className="rounded-lg bg-primary-light p-2.5">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text-secondary">{label}</p>
        <p className="text-2xl font-bold text-text mt-0.5 tabular-nums">{value}</p>
      </div>
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────

/**
 *
 */
export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery<SystemStats>({
    queryKey: ['admin', 'stats'],
    queryFn: adminApi.getStats,
  });

  if (isLoading || !stats) return <PageLoader />;

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Admin Dashboard</h1>
          <p className="text-sm text-text-secondary mt-1">System overview and management</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/admin/users">
            <Button variant="outline" size="sm">
              <UserCog className="h-4 w-4" /> Manage Users
            </Button>
          </Link>
          <Link to="/admin/settings">
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4" /> Settings
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={Users} label="Users" value={stats.totalUsers} />
        <StatCard icon={Building2} label="Organizations" value={stats.totalOrgs} />
        <StatCard icon={GitFork} label="Repositories" value={stats.totalRepos} />
        <StatCard icon={CircleDot} label="Issues" value={stats.totalIssues} />
        <StatCard icon={FileText} label="Wiki Pages" value={stats.totalWikiPages} />
        <StatCard icon={HardDrive} label="Storage" value={formatBytes(stats.storage.totalBytes)} />
      </div>

      {/* Database info */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2 mb-3">
          <HardDrive className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm text-text">Storage Breakdown</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-lg bg-surface-secondary p-3">
            <p className="text-xs text-text-tertiary">Git Repositories</p>
            <p className="text-lg font-semibold text-text mt-1">
              {formatBytes(stats.storage.reposBytes)}
            </p>
          </div>
          <div className="rounded-lg bg-surface-secondary p-3">
            <p className="text-xs text-text-tertiary">File Storage</p>
            <p className="text-lg font-semibold text-text mt-1">
              {formatBytes(stats.storage.storageBytes)}
            </p>
          </div>
          <div className="rounded-lg bg-surface-secondary p-3">
            <p className="text-xs text-text-tertiary">Database</p>
            <p className="text-lg font-semibold text-text mt-1">{stats.databaseSize}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
