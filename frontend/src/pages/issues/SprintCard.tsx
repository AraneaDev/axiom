import { useQueryClient } from '@tanstack/react-query';
import {
  Play,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Target,
  Calendar,
  ArrowRight,
  Trash2,
  GripVertical,
  Pencil,
  Check,
  X,
  BarChart3,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { sprintsApi } from '@/api/sprints.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Dropdown';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { Modal } from '@/components/ui/Modal';
import { PriorityBadge } from '@/components/ui/PriorityBadge';
import { useDraftState } from '@/hooks/useDraftState';
import { useIssueInvalidation } from '@/hooks/useIssueInvalidation';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import type { Issue, Sprint } from '@/lib/types';
import { formatDate } from '@/lib/utils';

const STATUS_BADGE: Record<string, 'default' | 'primary' | 'success'> = {
  PLANNING: 'default',
  ACTIVE: 'primary',
  COMPLETED: 'success',
};

function IssueRow({
  issue,
  org,
  team,
  project,
  sprints,
  onMoveToSprint,
  onRemoveFromSprint,
}: {
  issue: Issue;
  org: string;
  team: string;
  project: string;
  sprints: Sprint[];
  onMoveToSprint: (issueId: string, sprintId: string) => void;
  onRemoveFromSprint?: (issueId: string) => void;
}) {
  const navigate = useNavigate();
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  return (
    <div className="flex items-center gap-2 px-3 py-2 hover:bg-surface-tertiary rounded-md group transition-colors">
      <GripVertical className="h-3.5 w-3.5 text-text-tertiary opacity-0 group-hover:opacity-50 cursor-grab" />
      <IssueTypeIcon type={issue.type} className="h-3.5 w-3.5 shrink-0" />
      <Button
        variant="ghost"
        size="xs"
        className="font-mono text-xs text-text-secondary hover:text-primary shrink-0 px-1"
        onClick={() => navigate(`/${org}/${team}/${project}/issues/${issue.number}`)}
      >
        <Target className="h-3 w-3" /> {issue.key}
      </Button>
      <Button
        variant="ghost"
        size="xs"
        className="text-sm text-text truncate flex-1 text-left hover:text-primary justify-start px-1"
        onClick={() => navigate(`/${org}/${team}/${project}/issues/${issue.number}`)}
      >
        <ChevronRight className="h-3 w-3 opacity-0" /> {issue.title}
      </Button>
      {issue.storyPoints != null && (
        <span className="text-[10px] bg-surface-tertiary text-text-secondary px-1.5 py-0.5 rounded-full tabular-nums">
          {issue.storyPoints} SP
        </span>
      )}
      <PriorityBadge priority={issue.priority} className="text-[10px]" />
      {issue.column && <Badge variant="default">{issue.column.name}</Badge>}
      <div className="relative">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setShowMoveMenu(!showMoveMenu)}
          title="Move to sprint"
        >
          <ArrowRight className="h-3 w-3" />
        </Button>
        {showMoveMenu && (
          <div className="absolute right-0 top-full mt-1 z-50 bg-surface-elevated border border-border rounded-lg shadow-lg py-1 min-w-[180px]">
            {onRemoveFromSprint && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start rounded-none px-3 text-text-secondary"
                onClick={() => {
                  onRemoveFromSprint(issue.id);
                  setShowMoveMenu(false);
                }}
              >
                <ArrowRight className="h-3 w-3" /> Move to Backlog
              </Button>
            )}
            {sprints
              .filter((s) => s.status !== 'COMPLETED')
              .map((s) => (
                <Button
                  key={s.id}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start rounded-none px-3 text-text-secondary"
                  onClick={() => {
                    onMoveToSprint(issue.id, s.id);
                    setShowMoveMenu(false);
                  }}
                >
                  <ArrowRight className="h-3 w-3" /> {s.name}
                  <Badge variant={STATUS_BADGE[s.status]} className="ml-2 text-[9px]">
                    {s.status}
                  </Badge>
                </Button>
              ))}
            {sprints.filter((s) => s.status !== 'COMPLETED').length === 0 && (
              <span className="block px-3 py-1.5 text-xs text-text-tertiary">
                No sprints available
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface SprintCardProps {
  sprint: Sprint;
  org: string;
  team: string;
  project: string;
  projectId: string;
  allSprints: Sprint[];
}

/**
 *
 * @param root0
 * @param root0.sprint
 * @param root0.org
 * @param root0.team
 * @param root0.project
 * @param root0.projectId
 * @param root0.allSprints
 */
export function SprintCard({ sprint, org, team, project, projectId, allSprints }: SprintCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { invalidateSprints } = useIssueInvalidation(projectId);
  const [collapsed, setCollapsed] = useState(sprint.status === 'COMPLETED');
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [moveToSprintId, setMoveToSprintId] = useState<string>('');
  const goalDraftState = useDraftState('');

  const startMutation = useMutationWithToast(() => sprintsApi.start(projectId, sprint.id), {
    successMessage: 'Sprint started',
    onSuccess: () => invalidateSprints(),
  });

  const completeMutation = useMutationWithToast(
    () => sprintsApi.complete(projectId, sprint.id, moveToSprintId || undefined),
    {
      successMessage: 'Sprint completed',
      invalidateKeys: [['velocity', projectId]],
      onSuccess: () => {
        invalidateSprints();
        setShowCompleteModal(false);
      },
    },
  );

  const addIssuesMutation = useMutationWithToast(
    (issueIds: string[]) => sprintsApi.addIssues(projectId, sprint.id, issueIds),
    {
      successMessage: null,
      onSuccess: () => invalidateSprints(),
    },
  );

  const removeIssueMutation = useMutationWithToast(
    (issueId: string) => sprintsApi.removeIssue(projectId, sprint.id, issueId),
    {
      successMessage: null,
      onSuccess: () => invalidateSprints(),
    },
  );

  const updateGoalMutation = useMutationWithToast(
    (goal: string) => sprintsApi.update(projectId, sprint.id, { goal }),
    {
      successMessage: null,
      onSuccess: () => {
        invalidateSprints();
        goalDraftState.reset();
      },
    },
  );

  const totalPoints =
    sprint._storyPoints ?? sprint.issues.reduce((s, i) => s + (i.storyPoints ?? 0), 0);
  const startStr = formatDate(sprint.startDate);
  const endStr = formatDate(sprint.endDate);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.issueId) {
        addIssuesMutation.mutate([data.issueId]);
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <Card
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={handleDrop}
    >
      {/* Sprint header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-light">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setCollapsed(!collapsed)}
          className="text-text-secondary hover:text-text p-1"
          title={collapsed ? 'Expand sprint' : 'Collapse sprint'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
        <Target className="h-4 w-4 text-text-tertiary" />
        <span className="font-medium text-sm">{sprint.name}</span>
        <Badge variant={STATUS_BADGE[sprint.status]}>{sprint.status}</Badge>
        <span className="text-xs text-text-tertiary flex items-center gap-1">
          <Calendar className="h-3 w-3" /> {startStr} - {endStr}
        </span>
        <span className="text-xs text-text-secondary ml-auto tabular-nums">
          {totalPoints} pts | {sprint.issues.length} issues
        </span>

        {sprint.status === 'PLANNING' && (
          <Button variant="outline" size="xs" onClick={() => startMutation.mutate()}>
            <Play className="h-3 w-3" /> Start Sprint
          </Button>
        )}
        {(sprint.status === 'ACTIVE' || sprint.status === 'COMPLETED') && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => navigate(`/${org}/${team}/${project}/sprints/${sprint.id}/report`)}
            title="Sprint Report"
          >
            <BarChart3 className="h-3 w-3" /> Report
          </Button>
        )}
        {sprint.status === 'ACTIVE' && (
          <Button variant="outline" size="xs" onClick={() => setShowCompleteModal(true)}>
            <CheckCircle2 className="h-3 w-3" /> Complete Sprint
          </Button>
        )}
      </div>

      {/* Sprint goal */}
      {!collapsed && (goalDraftState.isEditing || sprint.goal) && (
        <div className="px-4 py-2 bg-surface-secondary/50 border-b border-border-light text-xs text-text-secondary">
          {goalDraftState.isEditing ? (
            <div className="space-y-2">
              <MarkdownEditor
                value={goalDraftState.draft}
                onChange={goalDraftState.setDraft}
                compact
              />
              <div className="flex gap-2">
                <Button
                  size="xs"
                  disabled={updateGoalMutation.isPending}
                  onClick={() => updateGoalMutation.mutate(goalDraftState.draft)}
                >
                  <Check className="h-3 w-3" /> Save
                </Button>
                <Button size="xs" variant="ghost" onClick={() => goalDraftState.cancel()}>
                  <X className="h-3 w-3" /> Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="group flex items-start gap-1">
              <span>Goal: </span>
              <MarkdownRenderer content={sprint.goal!} className="inline" />
              <Button
                variant="ghost"
                size="xs"
                className="opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                title="Edit goal"
                onClick={() => goalDraftState.startEditing(sprint.goal ?? '')}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Sprint issues */}
      {!collapsed && (
        <div className="p-2">
          {sprint.issues.length === 0 ? (
            <div className="text-center py-4 text-text-tertiary text-xs">
              Drag issues here or use the arrow button to add issues to this sprint.
            </div>
          ) : (
            sprint.issues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                org={org}
                team={team}
                project={project}
                sprints={allSprints}
                onMoveToSprint={(issueId, sprintId) => {
                  removeIssueMutation.mutate(issueId, {
                    onSuccess: () => {
                      sprintsApi.addIssues(projectId, sprintId, [issueId]).then(() => {
                        queryClient.invalidateQueries({ queryKey: ['sprints', projectId] });
                      });
                    },
                  });
                }}
                onRemoveFromSprint={(issueId) => removeIssueMutation.mutate(issueId)}
              />
            ))
          )}
        </div>
      )}

      {/* Complete Sprint Modal */}
      {showCompleteModal && (
        <Modal
          open={showCompleteModal}
          title="Complete Sprint"
          onClose={() => setShowCompleteModal(false)}
        >
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              {sprint.issues.filter((i) => !i.column?.name?.toLowerCase().includes('done')).length}{' '}
              incomplete issues will be moved.
            </p>
            <Select
              label="Move incomplete issues to:"
              value={moveToSprintId}
              onChange={(v) => setMoveToSprintId(v as string)}
              options={[
                { value: '', label: 'Backlog (no sprint)' },
                ...allSprints
                  .filter((s) => s.id !== sprint.id && s.status !== 'COMPLETED')
                  .map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCompleteModal(false)}>
                <Trash2 className="h-4 w-4" /> Cancel
              </Button>
              <Button onClick={() => completeMutation.mutate()}>
                <CheckCircle2 className="h-4 w-4" /> Complete Sprint
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}
