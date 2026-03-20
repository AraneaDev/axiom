import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, X, Save, Key, EyeOff, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

import { deploymentsApi } from '@/api/deployments.api';
import type { EnvironmentVariable } from '@/api/deployments.api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { formatRelative } from '@/lib/utils';

interface EnvironmentSecretsProps {
  repoId: string;
  envId: string;
}

/**
 *
 * @param root0
 * @param root0.repoId
 * @param root0.envId
 */
export function EnvironmentSecrets({ repoId, envId }: EnvironmentSecretsProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingVar, setEditingVar] = useState<EnvironmentVariable | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnvironmentVariable | null>(null);
  const [varName, setVarName] = useState('');
  const [varValue, setVarValue] = useState('');

  const { data: variables = [], isLoading } = useQuery({
    queryKey: ['env-variables', repoId, envId],
    queryFn: () => deploymentsApi.listEnvVariables(repoId, envId),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; value: string }) =>
      deploymentsApi.createEnvVariable(repoId, envId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['env-variables', repoId, envId] });
      setShowAddModal(false);
      setVarName('');
      setVarValue('');
      toast.success('Variable added');
    },
    onError: () => toast.error('Failed to add variable'),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      variableId,
      data,
    }: {
      variableId: string;
      data: { name: string; value: string };
    }) => deploymentsApi.updateEnvVariable(repoId, envId, variableId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['env-variables', repoId, envId] });
      setEditingVar(null);
      setVarName('');
      setVarValue('');
      toast.success('Variable updated');
    },
    onError: () => toast.error('Failed to update variable'),
  });

  const deleteMutation = useMutation({
    mutationFn: (variableId: string) => deploymentsApi.deleteEnvVariable(repoId, envId, variableId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['env-variables', repoId, envId] });
      setDeleteTarget(null);
      toast.success('Variable deleted');
    },
    onError: () => toast.error('Failed to delete variable'),
  });

  if (isLoading) return <PageLoader />;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-secondary">Variables</h3>
        <Button size="sm" onClick={() => setShowAddModal(true)}>
          <Plus className="h-4 w-4" /> Add Variable
        </Button>
      </div>

      <div className="rounded border border-border bg-surface-secondary px-4 py-2 mb-4 flex items-start gap-2 text-xs text-text-secondary">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" />
        <span>
          Variable values are encrypted and cannot be viewed after creation. You can only overwrite
          them with a new value.
        </span>
      </div>

      {variables.length === 0 ? (
        <EmptyState
          icon={<Key className="h-10 w-10" />}
          title="No variables"
          description="Add environment variables and secrets for this environment."
          action={
            <Button onClick={() => setShowAddModal(true)}>
              <Plus className="h-4 w-4" /> Add Variable
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-secondary border-b border-border text-left">
                <th className="px-4 py-2 font-medium text-text-secondary">Name</th>
                <th className="px-4 py-2 font-medium text-text-secondary">Value</th>
                <th className="px-4 py-2 font-medium text-text-secondary">Updated</th>
                <th className="px-4 py-2 font-medium text-text-secondary w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {variables.map((v: EnvironmentVariable) => (
                <tr key={v.id} className="hover:bg-surface-secondary transition-colors">
                  <td className="px-4 py-2">
                    <code className="text-xs font-mono text-text">{v.name}</code>
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-xs text-text-tertiary font-mono flex items-center gap-1">
                      <EyeOff className="h-3 w-3" /> ****
                    </span>
                  </td>
                  <td className="px-4 py-2 text-text-tertiary text-xs">
                    {formatRelative(v.updatedAt)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        title="Update variable"
                        onClick={() => {
                          setEditingVar(v);
                          setVarName(v.name);
                          setVarValue('');
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        title="Delete variable"
                        onClick={() => setDeleteTarget(v)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-danger" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Variable Modal */}
      <Modal
        open={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setVarName('');
          setVarValue('');
        }}
        title="Add Variable"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate({ name: varName, value: varValue });
          }}
          className="space-y-4"
        >
          <Input
            label="Name"
            placeholder="e.g. DATABASE_URL, API_KEY"
            value={varName}
            onChange={(e) => setVarName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
            required
          />
          <Input
            label="Value"
            placeholder="Enter secret value"
            value={varValue}
            onChange={(e) => setVarValue(e.target.value)}
            required
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setShowAddModal(false);
                setVarName('');
                setVarValue('');
              }}
            >
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button type="submit" disabled={!varName || !varValue || createMutation.isPending}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Variable Modal */}
      <Modal
        open={!!editingVar}
        onClose={() => {
          setEditingVar(null);
          setVarName('');
          setVarValue('');
        }}
        title="Update Variable"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!editingVar) return;
            updateMutation.mutate({
              variableId: editingVar.id,
              data: { name: varName, value: varValue },
            });
          }}
          className="space-y-4"
        >
          <Input
            label="Name"
            value={varName}
            onChange={(e) => setVarName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
            required
          />
          <Input
            label="New Value"
            placeholder="Enter new secret value"
            value={varValue}
            onChange={(e) => setVarValue(e.target.value)}
            required
          />
          <p className="text-xs text-text-tertiary">
            The previous value cannot be retrieved. Enter a new value to overwrite it.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setEditingVar(null);
                setVarName('');
                setVarValue('');
              }}
            >
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button type="submit" disabled={!varName || !varValue || updateMutation.isPending}>
              <Save className="h-4 w-4" /> Update
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Variable Confirmation */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Variable"
        size="sm"
      >
        <p className="text-sm text-text-secondary">
          Are you sure you want to delete{' '}
          <code className="text-text font-mono">{deleteTarget?.name}</code>? This action cannot be
          undone.
        </p>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
