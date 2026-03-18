import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Server, Database, FolderOpen, Globe, Tag, Shield } from 'lucide-react';
import { Link } from 'react-router';

import { adminApi } from '@/api/admin.api';
import type { SystemSettings as SystemSettingsType } from '@/api/admin.api';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';

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
  const { data: settings, isLoading } = useQuery<SystemSettingsType>({
    queryKey: ['admin', 'settings'],
    queryFn: adminApi.getSettings,
  });

  if (isLoading || !settings) return <PageLoader />;

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
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
      <div className="rounded-xl border border-border bg-surface p-5">
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
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2 mb-4">
          <Database className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm text-text">Storage</h3>
        </div>
        <div className="divide-y divide-border-light">
          <SettingRow icon={FolderOpen} label="Repositories Path" value={settings.reposPath} />
          <SettingRow icon={FolderOpen} label="Storage Path" value={settings.storagePath} />
        </div>
      </div>
    </div>
  );
}
