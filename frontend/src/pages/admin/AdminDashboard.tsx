import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Users,
  Building2,
  Database,
  CircleDot,
  Cpu,
  FileText,
  GitBranch,
  Globe,
  HardDrive,
  Server,
  Settings,
  Shield,
  UserCog,
} from 'lucide-react';
import { Link } from 'react-router';

import { adminApi } from '@/api/admin.api';
import type { SystemStats } from '@/api/admin.api';
import { healthApi } from '@/api/health.api';
import type { HealthStatus } from '@/api/health.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { PageLoader } from '@/components/ui/Spinner';
import { formatSize } from '@/lib/format';
import { cn } from '@/lib/utils';

// --- Uptime Formatter ---

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds % 60}s`;
}

// --- Health Panel ---

function HealthSkeleton() {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg bg-surface-secondary p-4">
            <Skeleton className="h-4 w-20 mb-2" />
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
    </Card>
  );
}

function serviceStatusVariant(status: string): 'success' | 'danger' | 'warning' {
  if (status === 'up') return 'success';
  if (status === 'not_configured') return 'warning';
  return 'danger';
}

function serviceStatusLabel(status: string): string {
  if (status === 'up') return 'Up';
  if (status === 'not_configured') return 'N/A';
  return 'Down';
}

function overallStatusVariant(status: HealthStatus['status']): 'success' | 'warning' | 'danger' {
  if (status === 'healthy') return 'success';
  if (status === 'degraded') return 'warning';
  return 'danger';
}

function overallStatusLabel(status: HealthStatus['status']): string {
  if (status === 'healthy') return 'Healthy';
  if (status === 'degraded') return 'Degraded';
  return 'Unhealthy';
}

function HealthPanel() {
  const {
    data: health,
    isLoading,
    isError,
  } = useQuery<HealthStatus>({
    queryKey: ['health'],
    queryFn: healthApi.check,
    staleTime: 60_000,
  });

  if (isLoading) return <HealthSkeleton />;

  if (isError || !health) {
    return (
      <div className="rounded-lg border border-danger bg-danger-light p-5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-danger" />
          <span className="text-sm font-semibold text-danger">
            System health check failed -- API may be unreachable
          </span>
        </div>
      </div>
    );
  }

  const services: {
    icon: LucideIcon;
    name: string;
    status: string;
    latencyMs: number;
  }[] = [
    {
      icon: Database,
      name: 'Database',
      status: health.services.database.status,
      latencyMs: health.services.database.latencyMs,
    },
    {
      icon: Cpu,
      name: 'Redis',
      status: health.services.redis.status,
      latencyMs: health.services.redis.latencyMs,
    },
  ];

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm text-text">System Health</h3>
        </div>
        <Badge variant={overallStatusVariant(health.status)}>
          {overallStatusLabel(health.status)}
        </Badge>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {services.map((svc) => (
          <div
            key={svc.name}
            className="rounded-lg bg-surface-secondary p-4 flex items-center gap-3"
          >
            <div className="rounded-md bg-surface-tertiary p-2">
              <svc.icon className="h-4 w-4 text-text-secondary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-text-tertiary">{svc.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant={serviceStatusVariant(svc.status)} size="sm">
                  {serviceStatusLabel(svc.status)}
                </Badge>
                {svc.status === 'up' && (
                  <span className="text-xs text-text-tertiary tabular-nums">{svc.latencyMs}ms</span>
                )}
              </div>
            </div>
          </div>
        ))}
        <div className="rounded-lg bg-surface-secondary p-4 flex items-center gap-3">
          <div className="rounded-md bg-surface-tertiary p-2">
            <Server className="h-4 w-4 text-text-secondary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-text-tertiary">API Uptime</p>
            <p className="text-sm font-semibold text-text mt-0.5 tabular-nums">
              {formatUptime(health.uptime)}
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}

// --- Stat Card ---

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
    <Card className={cn('p-5 flex items-start gap-4', className)}>
      <div className="rounded-lg bg-primary-light p-2.5">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text-secondary">{label}</p>
        <p className="text-2xl font-bold text-text mt-0.5 tabular-nums">{value}</p>
      </div>
    </Card>
  );
}

// --- Main ---

/**
 *
 */
export default function AdminDashboard() {
  const {
    data: stats,
    isLoading,
    error,
  } = useQuery<SystemStats>({
    queryKey: ['admin', 'stats'],
    queryFn: adminApi.getStats,
  });

  if (isLoading || !stats) return <PageLoader />;

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Activity className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load admin dashboard</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="h2">Admin Dashboard</h1>
          <p className="text-sm text-text-secondary mt-1">System overview and management</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/admin/users">
            <Button variant="outline" size="sm">
              <UserCog className="h-4 w-4" /> Manage Users
            </Button>
          </Link>
          <Link to="/admin/landing">
            <Button variant="outline" size="sm">
              <Globe className="h-4 w-4" /> Landing Page
            </Button>
          </Link>
          <Link to="/admin/github">
            <Button variant="outline" size="sm">
              <GitBranch className="h-4 w-4" /> GitHub
            </Button>
          </Link>
          <Link to="/admin/security">
            <Button variant="outline" size="sm">
              <Shield className="h-4 w-4" /> Security
            </Button>
          </Link>
          <Link to="/admin/settings">
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4" /> Settings
            </Button>
          </Link>
        </div>
      </div>

      {/* System Health */}
      <HealthPanel />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={Users} label="Users" value={stats.totalUsers} />
        <StatCard icon={Building2} label="Organizations" value={stats.totalOrgs} />
        <StatCard icon={CircleDot} label="Issues" value={stats.totalIssues} />
        <StatCard icon={FileText} label="Wiki Pages" value={stats.totalWikiPages} />
        <StatCard icon={HardDrive} label="Storage" value={formatSize(stats.storage.totalBytes)} />
      </div>

      {/* Database info */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <HardDrive className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm text-text">Storage Breakdown</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-lg bg-surface-secondary p-3">
            <p className="text-xs text-text-tertiary">File Storage</p>
            <p className="text-lg font-semibold text-text mt-1">
              {formatSize(stats.storage.storageBytes)}
            </p>
          </div>
          <div className="rounded-lg bg-surface-secondary p-3">
            <p className="text-xs text-text-tertiary">Database</p>
            <p className="text-lg font-semibold text-text mt-1">{stats.databaseSize}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
