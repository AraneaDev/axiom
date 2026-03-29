import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Server,
  Database,
  FolderOpen,
  Globe,
  Tag,
  Shield,
  AlertTriangle,
} from 'lucide-react';
import { Link } from 'react-router';

import { adminApi } from '@/api/admin.api';
import type { SystemSettings as SystemSettingsType } from '@/api/admin.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';

// ─── Setting Row ────────────────────────────────────────────

function SettingRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Server;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border-light last:border-0">
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 text-text-tertiary" />
        <span className="text-sm text-text-secondary">{label}</span>
      </div>
      <code className="text-sm text-text bg-surface-secondary px-2 py-0.5 rounded">{value}</code>
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────

/**
 *
 */
export default function SystemSettings() {
  const {
    data: settings,
    isLoading,
    error,
  } = useQuery<SystemSettingsType>({
    queryKey: ['admin', 'settings'],
    queryFn: adminApi.getSettings,
  });

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load system settings</p>
        </div>
      </div>
    );
  }

  if (isLoading || !settings)
    return (
      <div className="px-6 py-4 space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-md" />
          <div>
            <Skeleton className="h-6 w-48 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="p-5 space-y-3">
            <Skeleton className="h-4 w-32 mb-3" />
            {Array.from({ length: i === 0 ? 4 : 2 }).map((_, j) => (
              <div key={j} className="flex items-center justify-between py-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-40 rounded" />
              </div>
            ))}
          </Card>
        ))}
      </div>
    );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/admin">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-text">System Settings</h1>
          <p className="text-sm text-text-secondary mt-1">
            Current system configuration (read-only)
          </p>
        </div>
      </div>

      {/* Settings */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Server className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm text-text">Server Configuration</h3>
        </div>
        <div className="divide-y divide-border-light">
          <SettingRow icon={Tag} label="Version" value={settings.version} />
          <SettingRow icon={Shield} label="Environment" value={settings.nodeEnv} />
          <SettingRow icon={Server} label="Port" value={String(settings.port)} />
          <SettingRow icon={Globe} label="CORS Origin" value={settings.corsOrigin} />
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Database className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm text-text">Storage</h3>
        </div>
        <div className="divide-y divide-border-light">
          <SettingRow icon={FolderOpen} label="Repositories Path" value={settings.reposPath} />
          <SettingRow icon={FolderOpen} label="Storage Path" value={settings.storagePath} />
        </div>
      </Card>
    </div>
  );
}
