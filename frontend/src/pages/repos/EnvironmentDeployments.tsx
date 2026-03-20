import { useQuery } from '@tanstack/react-query';
import { Rocket, Clock } from 'lucide-react';

import { deploymentsApi } from '@/api/deployments.api';
import type { Deployment, DeploymentStatus } from '@/api/deployments.api';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageLoader } from '@/components/ui/Spinner';
import { formatRelative } from '@/lib/utils';

function statusVariant(status: DeploymentStatus): 'success' | 'danger' | 'warning' | 'default' {
  switch (status) {
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
      return 'danger';
    case 'IN_PROGRESS':
      return 'warning';
    case 'PENDING':
    default:
      return 'default';
  }
}

interface EnvironmentDeploymentsProps {
  repoId: string;
  envId: string;
}

/**
 *
 * @param root0
 * @param root0.repoId
 * @param root0.envId
 */
export function EnvironmentDeployments({ repoId, envId }: EnvironmentDeploymentsProps) {
  const { data: deployments, isLoading } = useQuery({
    queryKey: ['deployments', repoId, envId],
    queryFn: () => deploymentsApi.listDeployments(repoId, envId),
    enabled: !!envId,
  });

  if (isLoading) return <PageLoader />;

  if (!deployments || deployments.length === 0) {
    return (
      <EmptyState
        icon={<Rocket className="h-10 w-10" />}
        title="No deployments yet"
        description="No deployments have been recorded for this environment."
      />
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-secondary border-b border-border text-left">
            <th className="px-4 py-2 font-medium text-text-secondary">Status</th>
            <th className="px-4 py-2 font-medium text-text-secondary">Commit</th>
            <th className="px-4 py-2 font-medium text-text-secondary">Deployed By</th>
            <th className="px-4 py-2 font-medium text-text-secondary">Pipeline</th>
            <th className="px-4 py-2 font-medium text-text-secondary">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {deployments.map((d: Deployment) => (
            <tr key={d.id} className="hover:bg-surface-secondary transition-colors">
              <td className="px-4 py-2">
                <Badge variant={statusVariant(d.status)} size="sm">
                  {d.status.toLowerCase().replace('_', ' ')}
                </Badge>
              </td>
              <td className="px-4 py-2">
                <code className="text-xs font-mono text-primary">{d.commitSha.slice(0, 7)}</code>
              </td>
              <td className="px-4 py-2 text-text-secondary">
                {d.deployedBy?.displayName || d.deployedBy?.username || 'Unknown'}
              </td>
              <td className="px-4 py-2 text-text-secondary">
                {d.pipelineRun?.pipeline?.name || '--'}
              </td>
              <td className="px-4 py-2 text-text-tertiary">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatRelative(d.createdAt)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
