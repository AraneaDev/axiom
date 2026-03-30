import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Flag,
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  Calendar,
  RotateCcw,
  X,
  CircleDot,
  CheckCircle,
  List,
} from 'lucide-react';
import { useState } from 'react';

import { milestonesApi, type Milestone } from '@/api/milestones.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { Textarea } from '@/components/ui/Textarea';
import { useModalState } from '@/hooks/useModalState';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useProjectContext } from '@/hooks/useProjectContext';
import { cn, formatDate } from '@/lib/utils';

type FilterTab = 'all' | 'open' | 'closed';

function isDueSoon(dateStr: string) {
  const due = new Date(dateStr);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 7;
}

function isOverdue(dateStr: string) {
  return new Date(dateStr) < new Date();
}

interface MilestoneCardProps {
  milestone: Milestone;
  onToggleStatus: (milestone: Milestone) => void;
  onDelete: (milestone: Milestone) => void;
  isToggling: boolean;
  isDeleting: boolean;
}

function MilestoneCard({
  milestone,
  onToggleStatus,
  onDelete,
  isToggling,
  isDeleting,
}: MilestoneCardProps) {
  const isOpen = milestone.status === 'OPEN';

  return (
    <Card className="p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Flag
            className={cn(
              'h-5 w-5 shrink-0 mt-0.5',
              isOpen ? 'text-primary' : 'text-text-tertiary',
            )}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-text truncate">{milestone.title}</span>
              <Badge variant={isOpen ? 'primary' : 'default'} size="sm">
                {isOpen ? 'Open' : 'Closed'}
              </Badge>
            </div>
            {milestone.description && (
              <p className="text-sm text-text-secondary mt-1 line-clamp-2">
                {milestone.description}
              </p>
            )}
            <div className="flex items-center gap-4 mt-2 text-xs text-text-tertiary flex-wrap">
              <span className="flex items-center gap-1">
                <Circle className="h-3.5 w-3.5" />
                {milestone.issueCount} {milestone.issueCount === 1 ? 'issue' : 'issues'}
              </span>
              {milestone.dueDate && (
                <span
                  className={cn(
                    'flex items-center gap-1',
                    isOpen && isOverdue(milestone.dueDate) && 'text-danger font-medium',
                    isOpen &&
                      isDueSoon(milestone.dueDate) &&
                      !isOverdue(milestone.dueDate) &&
                      'text-warning font-medium',
                  )}
                >
                  <Calendar className="h-3.5 w-3.5" />
                  Due {formatDate(milestone.dueDate)}
                  {isOpen && isOverdue(milestone.dueDate) && ' (overdue)'}
                  {isOpen &&
                    isDueSoon(milestone.dueDate) &&
                    !isOverdue(milestone.dueDate) &&
                    ' (soon)'}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onToggleStatus(milestone)}
            disabled={isToggling}
            title={isOpen ? 'Close milestone' : 'Reopen milestone'}
          >
            {isOpen ? <CheckCircle2 className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
            {isOpen ? 'Close' : 'Reopen'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(milestone)}
            disabled={isDeleting}
            title="Delete milestone"
            className="text-danger hover:text-danger hover:bg-danger-light"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1 text-xs text-text-tertiary">
          <span>Progress</span>
          <span>{milestone.issueCount} issues</span>
        </div>
        <div className="w-full h-2 rounded-full bg-surface-tertiary overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              isOpen ? 'bg-primary' : 'bg-success',
            )}
            style={{ width: milestone.issueCount > 0 ? '0%' : '0%' }}
          />
        </div>
      </div>
    </Card>
  );
}

/**
 *
 */
export default function Milestones() {
  const { currentProject } = useProjectContext();

  const [filter, setFilter] = useState<FilterTab>('open');
  const createModal = useModalState();
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Milestone | null>(null);

  const {
    data: milestones = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['milestones', currentProject?.id],
    queryFn: () => milestonesApi.list(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const createMutation = useMutationWithToast(
    (data: { title: string; description?: string; dueDate?: string }) =>
      milestonesApi.create(currentProject!.id, data),
    {
      successMessage: 'Milestone created',
      errorMessage: 'Failed to create milestone',
      invalidateKeys: [['milestones', currentProject?.id]],
      onSuccess: () => {
        createModal.close();
        setNewTitle('');
        setNewDescription('');
        setNewDueDate('');
      },
    },
  );

  const updateMutation = useMutationWithToast(
    ({ id, data }: { id: string; data: Record<string, unknown> }) => milestonesApi.update(id, data),
    {
      successMessage: 'Milestone updated',
      errorMessage: 'Failed to update milestone',
      invalidateKeys: [['milestones', currentProject?.id]],
    },
  );

  const deleteMutation = useMutationWithToast((id: string) => milestonesApi.delete(id), {
    successMessage: 'Milestone deleted',
    errorMessage: 'Failed to delete milestone',
    invalidateKeys: [['milestones', currentProject?.id]],
    onSuccess: () => setConfirmDelete(null),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    createMutation.mutate({
      title: newTitle.trim(),
      description: newDescription.trim() || undefined,
      dueDate: newDueDate || undefined,
    });
  }

  function handleToggleStatus(milestone: Milestone) {
    updateMutation.mutate({
      id: milestone.id,
      data: { status: milestone.status === 'OPEN' ? 'CLOSED' : 'OPEN' },
    });
  }

  const filteredMilestones = milestones.filter((m) => {
    if (filter === 'open') return m.status === 'OPEN';
    if (filter === 'closed') return m.status === 'CLOSED';
    return true;
  });

  return (
    <div className="space-y-6 px-6 py-4">
      {/* Header */}
      <PageHeader title="Milestones" prefix={currentProject?.prefix}>
        <Button onClick={() => createModal.open()} disabled={!currentProject}>
          <Plus className="h-4 w-4" />
          New Milestone
        </Button>
      </PageHeader>

      {/* Filter tabs */}
      <Tabs
        tabs={[
          { key: 'open', label: 'Open', icon: <CircleDot className="h-4 w-4" /> },
          { key: 'closed', label: 'Closed', icon: <CheckCircle className="h-4 w-4" /> },
          { key: 'all', label: 'All', icon: <List className="h-4 w-4" /> },
        ]}
        activeKey={filter}
        onChange={(key) => setFilter(key as FilterTab)}
      />

      {/* Milestones list */}
      {error ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
            <p className="text-secondary">Failed to load milestones</p>
          </div>
        </div>
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-5 h-28 animate-pulse"></Card>
          ))}
        </div>
      ) : filteredMilestones.length === 0 ? (
        <EmptyState
          icon={<Flag />}
          title={filter === 'all' ? 'No milestones yet' : `No ${filter} milestones`}
          description={
            filter === 'all'
              ? 'Create a milestone to track progress toward a goal or release.'
              : undefined
          }
          action={
            filter === 'all' ? (
              <Button onClick={() => createModal.open()}>
                <Plus className="h-4 w-4" />
                New Milestone
              </Button>
            ) : undefined
          }
          card
        />
      ) : (
        <div className="space-y-3">
          {filteredMilestones.map((milestone) => (
            <MilestoneCard
              key={milestone.id}
              milestone={milestone}
              onToggleStatus={handleToggleStatus}
              onDelete={setConfirmDelete}
              isToggling={updateMutation.isPending && updateMutation.variables?.id === milestone.id}
              isDeleting={deleteMutation.isPending && deleteMutation.variables === milestone.id}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal open={createModal.isOpen} onClose={createModal.close} title="New Milestone" size="md">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            label="Title"
            required
            placeholder="e.g. v1.0 Release"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            autoFocus
          />
          <Textarea
            label="Description"
            placeholder="Optional description..."
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            rows={3}
          />
          <Input
            label="Due Date"
            type="date"
            value={newDueDate}
            onChange={(e) => setNewDueDate(e.target.value)}
          />
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => createModal.close()}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button type="submit" disabled={!newTitle.trim() || createMutation.isPending}>
              <Flag className="h-4 w-4" />
              Create Milestone
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
        title="Delete milestone"
        description={`Are you sure you want to delete "${confirmDelete?.title}"? This cannot be undone.`}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
