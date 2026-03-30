import { Plus, ExternalLink, Trash2, Pencil, X, Save, Server, GitCommit } from 'lucide-react';
import { useState } from 'react';

import { deploymentsApi } from '@/api/deployments.api';
import type { DeploymentEnvironment } from '@/api/deployments.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useModalState } from '@/hooks/useModalState';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { formatRelative } from '@/lib/utils';

interface EnvironmentsListProps {
  repoId: string;
  environments: DeploymentEnvironment[] | undefined;
  onSelectEnv: (env: DeploymentEnvironment) => void;
}

/**
 *
 * @param root0
 * @param root0.repoId
 * @param root0.environments
 * @param root0.onSelectEnv
 */
export function EnvironmentsList({ repoId, environments, onSelectEnv }: EnvironmentsListProps) {
  const createModal = useModalState();
  const [editingEnv, setEditingEnv] = useState<DeploymentEnvironment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [now] = useState(() => Date.now());

  const createMutation = useMutationWithToast(
    (data: { name: string; url?: string }) => deploymentsApi.createEnvironment(repoId, data),
    {
      successMessage: 'Environment created',
      errorMessage: 'Failed to create environment',
      invalidateKeys: [['environments', repoId]],
      onSuccess: () => {
        createModal.close();
        setFormName('');
        setFormUrl('');
      },
    },
  );

  const updateMutation = useMutationWithToast(
    ({ envId, data }: { envId: string; data: { name?: string; url?: string } }) =>
      deploymentsApi.updateEnvironment(repoId, envId, data),
    {
      successMessage: 'Environment updated',
      errorMessage: 'Failed to update environment',
      invalidateKeys: [['environments', repoId]],
      onSuccess: () => setEditingEnv(null),
    },
  );

  const deleteMutation = useMutationWithToast(
    (envId: string) => deploymentsApi.deleteEnvironment(repoId, envId),
    {
      successMessage: 'Environment deleted',
      errorMessage: 'Failed to delete environment',
      invalidateKeys: [['environments', repoId]],
    },
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Environments</h2>
        <Button size="sm" onClick={() => createModal.open()}>
          <Plus className="h-4 w-4" /> New Environment
        </Button>
      </div>

      {!environments || environments.length === 0 ? (
        <EmptyState
          icon={<Server className="h-10 w-10" />}
          title="No environments"
          description="Create deployment environments to track where your code is running."
          action={
            <Button onClick={() => createModal.open()}>
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
              <Card
                key={env.id}
                className="p-4 hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer"
                onClick={() => onSelectEnv(env)}
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
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Environment Modal */}
      <Modal
        open={createModal.isOpen}
        onClose={() => {
          createModal.close();
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
                createModal.close();
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
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
        title="Delete Environment"
        description="Are you sure you want to delete this environment? All deployment history will be lost."
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
