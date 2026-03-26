import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Flag,
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  Calendar,
  RotateCcw,
  X,
} from 'lucide-react';
import { useParams } from 'react-router';

import { milestonesApi, type Milestone } from '@/api/milestones.api';
import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { teamsApi } from '@/api/teams.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { STABLE_STALE_TIME } from '@/lib/constants';
import { cn } from '@/lib/utils';

type FilterTab = 'all' | 'open' | 'closed';

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

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
    <div className="rounded-lg border border-border bg-surface p-5 flex flex-col gap-3">
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
                    isOpen && isDueSoon(milestone.dueDate) && !isOverdue(milestone.dueDate) && 'text-warning font-medium',
                  )}
                >
                  <Calendar className="h-3.5 w-3.5" />
                  Due {formatDate(milestone.dueDate)}
                  {isOpen && isOverdue(milestone.dueDate) && ' (overdue)'}
                  {isOpen && isDueSoon(milestone.dueDate) && !isOverdue(milestone.dueDate) && ' (soon)'}
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
            {isOpen ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
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
    </div>
  );
}

/**
 *
 */
export default function Milestones() {
  const { org, team: teamSlug, project: projectSlug } = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [filter, setFilter] = useState<FilterTab>('open');
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Milestone | null>(null);

  // Project resolution
  const { data: orgs } = useQuery({
    queryKey: ['orgs'],
    queryFn: orgsApi.list,
    staleTime: STABLE_STALE_TIME,
  });
  const currentOrg = orgs?.find((o) => o.slug === org);

  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
    staleTime: STABLE_STALE_TIME,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);

  const { data: projects } = useQuery({
    queryKey: ['projects', currentTeam?.id],
    queryFn: () => projectsApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
    staleTime: STABLE_STALE_TIME,
  });
  const currentProject = projects?.find((p) => p.slug === projectSlug);

  const { data: milestones = [], isLoading } = useQuery({
    queryKey: ['milestones', currentProject?.id],
    queryFn: () => milestonesApi.list(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const createMutation = useMutation({
    mutationFn: (data: { title: string; description?: string; dueDate?: string }) =>
      milestonesApi.create(currentProject!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['milestones', currentProject?.id] });
      toast.success('Milestone created');
      setShowCreate(false);
      setNewTitle('');
      setNewDescription('');
      setNewDueDate('');
    },
    onError: () => toast.error('Failed to create milestone'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      milestonesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['milestones', currentProject?.id] });
      toast.success('Milestone updated');
    },
    onError: () => toast.error('Failed to update milestone'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => milestonesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['milestones', currentProject?.id] });
      toast.success('Milestone deleted');
      setConfirmDelete(null);
    },
    onError: () => toast.error('Failed to delete milestone'),
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

  const openCount = milestones.filter((m) => m.status === 'OPEN').length;
  const closedCount = milestones.filter((m) => m.status === 'CLOSED').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Flag className="h-6 w-6 text-primary" />
            Milestones
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Track progress toward project goals
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} disabled={!currentProject}>
          <Plus className="h-4 w-4" />
          New Milestone
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {(['open', 'closed', 'all'] as FilterTab[]).map((tab) => {
          const count = tab === 'open' ? openCount : tab === 'closed' ? closedCount : milestones.length;
          return (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={cn(
                'px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors',
                filter === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-secondary hover:text-text',
              )}
            >
              {tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              <span
                className={cn(
                  'ml-2 text-xs rounded-full px-1.5 py-0.5',
                  filter === tab ? 'bg-primary-light text-primary' : 'bg-surface-tertiary text-text-tertiary',
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Milestones list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-5 h-28 animate-pulse" />
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
              <Button onClick={() => setShowCreate(true)}>
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
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Milestone" size="md">
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
          <div>
            <label className="block text-sm font-medium text-text mb-1">Due Date</label>
            <input
              type="date"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-border-focus"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowCreate(false)}
            >
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

      {/* Delete confirmation modal */}
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete Milestone"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Are you sure you want to delete{' '}
            <span className="font-semibold text-text">{confirmDelete?.title}</span>? This action
            cannot be undone.
          </p>
          <div className="flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
