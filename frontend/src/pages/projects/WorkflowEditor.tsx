import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, GitBranch, Plus, Trash2, Workflow } from 'lucide-react';
import { useState } from 'react';

import { issuesApi } from '@/api/issues.api';
import { workflowsApi } from '@/api/workflows.api';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { Table, TableContainer, Tbody, Td, Th, Thead, TrHead } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useProjectContext } from '@/hooks/useProjectContext';
import type { BoardColumn } from '@/lib/types';

/**
 *
 */
export default function WorkflowEditor() {
  const { currentProject } = useProjectContext();
  const toast = useToast();

  const [fromColumnId, setFromColumnId] = useState('');
  const [toColumnId, setToColumnId] = useState('');

  // Fetch board columns
  const { data: columns } = useQuery({
    queryKey: ['board', currentProject?.id],
    queryFn: () => issuesApi.getBoard(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  // Fetch workflow rules
  const {
    data: rules,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['workflow-rules', currentProject?.id],
    queryFn: () => workflowsApi.listRules(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const createMutation = useMutationWithToast(
    (data: { fromColumnId: string; toColumnId: string }) =>
      workflowsApi.createRule(currentProject!.id, data),
    {
      successMessage: 'Workflow rule created',
      invalidateKeys: [['workflow-rules', currentProject?.id]],
      onSuccess: () => {
        setFromColumnId('');
        setToColumnId('');
      },
    },
  );

  const deleteMutation = useMutationWithToast(
    (ruleId: string) => workflowsApi.deleteRule(currentProject!.id, ruleId),
    {
      successMessage: 'Workflow rule deleted',
      invalidateKeys: [['workflow-rules', currentProject?.id]],
    },
  );

  const columnOptions = (columns ?? []).map((col: BoardColumn) => ({
    value: col.id,
    label: col.name,
  }));

  const handleAdd = () => {
    if (!fromColumnId || !toColumnId) return;
    if (fromColumnId === toColumnId) {
      toast.error('From and To columns must be different');
      return;
    }
    createMutation.mutate({ fromColumnId, toColumnId });
  };

  if (isLoading)
    return (
      <div>
        <ListSkeleton rows={4} />
      </div>
    );

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load workflow rules</p>
        </div>
      </div>
    );
  }

  return (
    <SettingsPage
      title="Workflow"
      description="Define transition rules that control how issues move between columns"
      icon={GitBranch}
      helpTitle="Workflow transitions"
      helpItems={[
        {
          title: 'Transition rules',
          description:
            'Each rule defines an allowed path from one column to another. Without rules, all transitions are allowed.',
        },
        {
          title: 'Adding rules',
          description:
            'Select a source and destination column, then add the rule. Issues will only be allowed to move along defined paths.',
        },
        {
          title: 'No rules = free-form',
          description:
            'If no transition rules are defined, issues can be moved freely between any columns.',
        },
      ]}
    >
      {/* Add rule form */}
      <div className="bg-surface-elevated border border-border rounded-lg p-4 mb-6">
        <h2 className="text-sm font-semibold mb-3">Add Transition Rule</h2>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Select
              label="From Column"
              options={columnOptions}
              value={fromColumnId}
              onChange={(v) => setFromColumnId(v as string)}
              placeholder="Select source..."
            />
          </div>
          <ArrowRight className="h-5 w-5 text-text-tertiary mb-2" />
          <div className="flex-1">
            <Select
              label="To Column"
              options={columnOptions}
              value={toColumnId}
              onChange={(v) => setToColumnId(v as string)}
              placeholder="Select target..."
            />
          </div>
          <Button
            onClick={handleAdd}
            disabled={!fromColumnId || !toColumnId || createMutation.isPending}
            size="md"
          >
            <Plus className="h-4 w-4" /> Add Rule
          </Button>
        </div>
      </div>

      {/* Rules table */}
      {rules && rules.length > 0 ? (
        <TableContainer>
          <Table>
            <Thead>
              <TrHead>
                <Th>From</Th>
                <Th />
                <Th>To</Th>
                <Th className="text-right">Actions</Th>
              </TrHead>
            </Thead>
            <Tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <Td className="font-medium">{rule.fromColumn.name}</Td>
                  <Td>
                    <ArrowRight className="h-4 w-4 text-text-tertiary" />
                  </Td>
                  <Td className="font-medium">{rule.toColumn.name}</Td>
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => deleteMutation.mutate(rule.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </Button>
                  </Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        </TableContainer>
      ) : (
        <EmptyState
          card
          icon={<Workflow className="h-10 w-10" />}
          title="No workflow rules defined"
          description="Without rules, issues can move freely between any columns. Add rules to restrict allowed transitions."
        />
      )}
    </SettingsPage>
  );
}
