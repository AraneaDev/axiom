import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  ExternalLink,
  Trash2,
  Pencil,
  ArrowLeft,
  Rocket,
  GitCommit,
  Clock,
  X,
  Save,
  Server,
} from 'lucide-react';
import { useState } from 'react';

import { deploymentsApi } from '@/api/deployments.api';
import type { DeploymentEnvironment, Deployment, DeploymentStatus } from '@/api/deployments.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { formatRelative } from '@/lib/utils';

interface EnvironmentsTabProps {
  repoId: string;
}

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

/**
 * Environments tab for repository detail page.
 * @param root0
 * @param root0.repoId
 */
export default function EnvironmentsTab({ repoId }: EnvironmentsTabProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedEnv, setSelectedEnv] = useState<DeploymentEnvironment | null>(null);
  const [editingEnv, setEditingEnv] = useState<DeploymentEnvironment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');

  const { data: environments, isLoading } = useQuery({
    queryKey: ['environments', repoId],
    queryFn: () => deploymentsApi.listEnvironments(repoId),
    enabled: !!repoId,
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; url?: string }) =>
      deploymentsApi.createEnvironment(repoId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environments', repoId] });
      setShowCreateModal(false);
      setFormName('');
      setFormUrl('');
      toast.success('Environment created');
    },
    onError: () => toast.error('Failed to create environment'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ envId, data }: { envId: string; data: { name?: string; url?: string } }) =>
      deploymentsApi.updateEnvironment(repoId, envId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environments', repoId] });
      setEditingEnv(null);
      toast.success('Environment updated');
    },
    onError: () => toast.error('Failed to update environment'),
  });

  const deleteMutation = useMutation({
    mutationFn: (envId: string) => deploymentsApi.deleteEnvironment(repoId, envId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environments', repoId] });
      setSelectedEnv(null);
      toast.success('Environment deleted');
    },
    onError: () => toast.error('Failed to delete environment'),
  });

  // Deployment history for selected environment
  const { data: deployments, isLoading: deploymentsLoading } = useQuery({
    queryKey: ['deployments', repoId, selectedEnv?.id],
    queryFn: () => deploymentsApi.listDeployments(repoId, selectedEnv!.id),
    enabled: !!selectedEnv?.id,
  });

  // Capture current time for recency checks (before early returns to satisfy hooks rule)
  const [now] = useState(() => Date.now());

  if (isLoading) return <PageLoader />;

  // Deployment history view
  if (selectedEnv) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="sm" onClick={() => setSelectedEnv(null)}>
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

        {deploymentsLoading ? (
          <PageLoader />
        ) : !deployments || deployments.length === 0 ? (
          <EmptyState
            icon={<Rocket className="h-10 w-10" />}
            title="No deployments yet"
            description="No deployments have been recorded for this environment."
          />
        ) : (
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
                      <code className="text-xs font-mono text-primary">
                        {d.commitSha.slice(0, 7)}
                      </code>
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
        )}
      </div>
    );
  }

  // Environment list view
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Environments</h2>
        <Button size="sm" onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4" /> New Environment
        </Button>
      </div>

      {!environments || environments.length === 0 ? (
        <EmptyState
          icon={<Server className="h-10 w-10" />}
          title="No environments"
          description="Create deployment environments to track where your code is running."
          action={
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="h-4 w-4" /> New Environment
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3">
          {environments.map((env: DeploymentEnvironment) => {
            const latestDeployment = env.deployments?.[0];
            const isRecent =
              env.lastDeployedAt &&
              now - new Date(env.lastDeployedAt).getTime() < 24 * 60 * 60 * 1000;

            return (
              <div
                key={env.id}
                className="rounded-lg border border-border bg-surface p-4 hover:bg-surface-secondary transition-colors cursor-pointer"
                onClick={() => setSelectedEnv(env)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                        isRecent ? 'bg-success' : 'bg-text-tertiary'
                      }`}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{env.name}</span>
                        {env.url && (
                          <a
                            href={env.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline text-xs flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3 w-3" /> {env.url}
                          </a>
                        )}
                      </div>
                      {latestDeployment ? (
                        <p className="text-xs text-text-secondary mt-1 flex items-center gap-2">
                          <GitCommit className="h-3 w-3" />
                          <code className="font-mono">
                            {latestDeployment.commitSha.slice(0, 7)}
                          </code>
                          <span>
                            deployed {env.lastDeployedAt ? formatRelative(env.lastDeployedAt) : ''}
                          </span>
                          {latestDeployment.deployedBy && (
                            <span>
                              by{' '}
                              {latestDeployment.deployedBy.displayName ||
                                latestDeployment.deployedBy.username}
                            </span>
                          )}
                        </p>
                      ) : (
                        <p className="text-xs text-text-tertiary mt-1">No deployments yet</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="xs"
                      title="Edit environment"
                      onClick={() => {
                        setEditingEnv(env);
                        setFormName(env.name);
                        setFormUrl(env.url || '');
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      title="Delete environment"
                      onClick={() => setDeleteTarget(env.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-danger" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Environment Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setFormName('');
          setFormUrl('');
        }}
        title="New Environment"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate({
              name: formName,
              url: formUrl || undefined,
            });
          }}
          className="space-y-4"
        >
          <Input
            label="Name"
            placeholder="e.g. production, staging, development"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            required
          />
          <Input
            label="URL"
            placeholder="https://example.com"
            value={formUrl}
            onChange={(e) => setFormUrl(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setShowCreateModal(false);
                setFormName('');
                setFormUrl('');
              }}
            >
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button type="submit" disabled={!formName || createMutation.isPending}>
              <Plus className="h-4 w-4" /> Create
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Environment Modal */}
      <Modal
        open={!!editingEnv}
        onClose={() => {
          setEditingEnv(null);
          setFormName('');
          setFormUrl('');
        }}
        title="Edit Environment"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!editingEnv) return;
            updateMutation.mutate({
              envId: editingEnv.id,
              data: {
                name: formName,
                url: formUrl || undefined,
              },
            });
          }}
          className="space-y-4"
        >
          <Input
            label="Name"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            required
          />
          <Input
            label="URL"
            placeholder="https://example.com"
            value={formUrl}
            onChange={(e) => setFormUrl(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setEditingEnv(null);
                setFormName('');
                setFormUrl('');
              }}
            >
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              <Save className="h-4 w-4" /> Save
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete environment confirmation */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete Environment"
        size="sm"
      >
        <p className="text-sm text-text-secondary">
          Are you sure you want to delete this environment? All deployment history will be lost.
        </p>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (deleteTarget) deleteMutation.mutate(deleteTarget);
              setDeleteTarget(null);
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
