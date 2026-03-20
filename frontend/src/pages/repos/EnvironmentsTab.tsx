import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useState } from 'react';

import { EnvironmentDeployments } from './EnvironmentDeployments';
import { EnvironmentSecrets } from './EnvironmentSecrets';
import { EnvironmentsList } from './EnvironmentsList';

import { deploymentsApi } from '@/api/deployments.api';
import type { DeploymentEnvironment } from '@/api/deployments.api';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
import { Tabs } from '@/components/ui/Tabs';

interface EnvironmentsTabProps {
  repoId: string;
}

/**
 *
 * @param root0
 * @param root0.repoId
 */
export default function EnvironmentsTab({ repoId }: EnvironmentsTabProps) {
  const [selectedEnv, setSelectedEnv] = useState<DeploymentEnvironment | null>(null);
  const [activeTab, setActiveTab] = useState('deployments');

  const { data: environments, isLoading } = useQuery({
    queryKey: ['environments', repoId],
    queryFn: () => deploymentsApi.listEnvironments(repoId),
    enabled: !!repoId,
  });

  if (isLoading) return <PageLoader />;

  if (selectedEnv) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedEnv(null);
              setActiveTab('deployments');
            }}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <h2 className="text-lg font-semibold">{selectedEnv.name}</h2>
          {selectedEnv.url && (
            <a
              href={selectedEnv.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline text-sm flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3" /> {selectedEnv.url}
            </a>
          )}
        </div>

        <Tabs
          tabs={[
            { key: 'deployments', label: 'Deployments' },
            { key: 'variables', label: 'Variables' },
          ]}
          activeKey={activeTab}
          onChange={setActiveTab}
        />

        <div className="mt-4">
          {activeTab === 'deployments' && (
            <EnvironmentDeployments repoId={repoId} envId={selectedEnv.id} />
          )}
          {activeTab === 'variables' && (
            <EnvironmentSecrets repoId={repoId} envId={selectedEnv.id} />
          )}
        </div>
      </div>
    );
  }

  return (
    <EnvironmentsList repoId={repoId} environments={environments} onSelectEnv={setSelectedEnv} />
  );
}
