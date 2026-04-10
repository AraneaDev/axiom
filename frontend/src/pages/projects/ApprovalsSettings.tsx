import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Plus,
  ShieldCheck,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { useState } from 'react';

import { approvalsApi, type ApprovalGate } from '@/api/approvals.api';
import { issuesApi } from '@/api/issues.api';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Select } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
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
export default function ApprovalsSettings() {
  const { currentProject } = useProjectContext();
  const toast = useToast();

  const [fromColumnId, setFromColumnId] = useState('');
  const [toColumnId, setToColumnId] = useState('');
  const [minApprovals, setMinApprovals] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Fetch board columns
  const { data: columns } = useQuery({
    queryKey: ['board', currentProject?.id],
    queryFn: () => issuesApi.getBoard(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  // Fetch approval gates
  const {
    data: gates,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['approval-gates', currentProject?.id],
    queryFn: () => approvalsApi.listGates(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const createMutation = useMutationWithToast(
    (data: { fromColumnId: string; toColumnId: string; minApprovals: number }) =>
      approvalsApi.createGate(currentProject!.id, data),
    {
      successMessage: 'Approval gate created',
      invalidateKeys: [['approval-gates', currentProject?.id]],
      onSuccess: () => {
        setFromColumnId('');
        setToColumnId('');
        setMinApprovals(1);
      },
    },
  );

  const deleteMutation = useMutationWithToast(
    (gateId: string) => approvalsApi.deleteGate(currentProject!.id, gateId),
    {
      successMessage: 'Approval gate deleted',
      invalidateKeys: [['approval-gates', currentProject?.id]],
      onSuccess: () => setDeleteTarget(null),
    },
  );

  const toggleMutation = useMutationWithToast(
    ({ gateId, enabled }: { gateId: string; enabled: boolean }) =>
      approvalsApi.updateGate(currentProject!.id, gateId, { enabled }),
    {
      successMessage: null,
      invalidateKeys: [['approval-gates', currentProject?.id]],
    },
  );

  const toggleSelfApprovalMutation = useMutationWithToast(
    ({ gateId, allowSelfApproval }: { gateId: string; allowSelfApproval: boolean }) =>
      approvalsApi.updateGate(currentProject!.id, gateId, { allowSelfApproval }),
    {
      successMessage: null,
      invalidateKeys: [['approval-gates', currentProject?.id]],
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
    if (minApprovals < 1) {
      toast.error('Minimum approvals must be at least 1');
      return;
    }
    createMutation.mutate({ fromColumnId, toColumnId, minApprovals });
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
          <p className="text-secondary">Failed to load approval gates</p>
        </div>
      </div>
    );
  }

  return (
    <SettingsPage
      title="Approvals"
      description="Configure approval gates that require sign-off before issues can transition between columns"
      icon={ShieldCheck}
      helpTitle="Approval gates"
      helpItems={[
        {
          title: 'Approval gates',
          description:
            'Each gate blocks a specific column transition until the required number of approvals is met.',
        },
        {
          title: 'Min approvals',
          description:
            'Set the minimum number of approvers that must approve before the transition is allowed.',
        },
        {
          title: 'Self-approval',
          description:
            'When disabled, the person requesting the transition cannot approve their own request.',
        },
      ]}
    >
      {/* Add gate form */}
      <div className="bg-surface-elevated border border-border rounded-lg p-4 mb-6">
        <h2 className="text-sm font-semibold mb-3">Add Approval Gate</h2>
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
          <div className="w-32">
            <Input
              label="Min Approvals"
              type="number"
              min={1}
              max={10}
              value={minApprovals}
              onChange={(e) => setMinApprovals(parseInt(e.target.value) || 1)}
            />
          </div>
          <Button
            onClick={handleAdd}
            disabled={!fromColumnId || !toColumnId || createMutation.isPending}
            size="md"
          >
            <Plus className="h-4 w-4" /> Add Gate
          </Button>
        </div>
      </div>

      {/* Gates table */}
      {gates && gates.length > 0 ? (
        <TableContainer>
          <Table>
            <Thead>
              <TrHead>
                <Th>From</Th>
                <Th />
                <Th>To</Th>
                <Th>Min Approvals</Th>
                <Th>Self-Approval</Th>
                <Th>Enabled</Th>
                <Th className="text-right">Actions</Th>
              </TrHead>
            </Thead>
            <Tbody>
              {gates.map((gate: ApprovalGate) => (
                <tr key={gate.id}>
                  <Td className="font-medium">{gate.fromColumn.name}</Td>
                  <Td>
                    <ArrowRight className="h-4 w-4 text-text-tertiary" />
                  </Td>
                  <Td className="font-medium">{gate.toColumn.name}</Td>
                  <Td>{gate.minApprovals}</Td>
                  <Td>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        toggleSelfApprovalMutation.mutate({
                          gateId: gate.id,
                          allowSelfApproval: !gate.allowSelfApproval,
                        })
                      }
                      title={
                        gate.allowSelfApproval ? 'Disable self-approval' : 'Enable self-approval'
                      }
                    >
                      {gate.allowSelfApproval ? (
                        <ToggleRight className="h-4 w-4 text-success" />
                      ) : (
                        <ToggleLeft className="h-4 w-4 text-text-tertiary" />
                      )}
                      {gate.allowSelfApproval ? 'Yes' : 'No'}
                    </Button>
                  </Td>
                  <Td>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        toggleMutation.mutate({
                          gateId: gate.id,
                          enabled: !gate.enabled,
                        })
                      }
                      title={gate.enabled ? 'Disable gate' : 'Enable gate'}
                    >
                      {gate.enabled ? (
                        <ToggleRight className="h-4 w-4 text-success" />
                      ) : (
                        <ToggleLeft className="h-4 w-4 text-text-tertiary" />
                      )}
                      {gate.enabled ? 'On' : 'Off'}
                    </Button>
                  </Td>
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setDeleteTarget(gate.id)}
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
          icon={<ShieldCheck className="h-10 w-10" />}
          title="No approval gates defined"
          description="Without gates, issues move freely between columns. Add gates to require approval before specific transitions."
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Approval Gate"
        description="This will delete the approval gate and automatically cancel any pending approval requests for this transition. This action cannot be undone."
        confirmLabel="Delete Gate"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </SettingsPage>
  );
}
