import { useQuery } from '@tanstack/react-query';
import { Rocket, Clock } from 'lucide-react';

import { deploymentsApi } from '@/api/deployments.api';
import type { Deployment, DeploymentStatus } from '@/api/deployments.api';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageLoader } from '@/components/ui/Spinner';
import { Table, TableContainer, Tbody, Td, Th, Thead, Tr, TrHead } from '@/components/ui/Table';
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
    <TableContainer>
      <Table>
        <Thead>
          <TrHead>
            <Th>Status</Th>
            <Th>Commit</Th>
            <Th>Deployed By</Th>
            <Th>Pipeline</Th>
            <Th>Time</Th>
          </TrHead>
        </Thead>
        <Tbody>
          {deployments.map((d: Deployment) => (
            <Tr key={d.id}>
              <Td>
                <Badge variant={statusVariant(d.status)} size="sm">
                  {d.status.toLowerCase().replace('_', ' ')}
                </Badge>
              </Td>
              <Td>
                <code className="text-xs font-mono text-primary">{d.commitSha.slice(0, 7)}</code>
              </Td>
              <Td className="text-text-secondary">
                {d.deployedBy?.displayName || d.deployedBy?.username || 'Unknown'}
              </Td>
              <Td className="text-text-secondary">{d.pipelineRun?.pipeline?.name || '--'}</Td>
              <Td className="text-text-tertiary">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatRelative(d.createdAt)}
                </span>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </TableContainer>
  );
}
