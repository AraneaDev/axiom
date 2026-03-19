import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
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
} from 'lucide-react';
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { sprintsApi } from '@/api/sprints.api';
import { teamsApi } from '@/api/teams.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { VelocityChart } from '@/components/VelocityChart';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '@/lib/constants';
import type { Issue, Sprint } from '@/lib/types';
import { cn } from '@/lib/utils';

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
      <button
        type="button"
        className="font-mono text-xs text-text-secondary hover:text-primary transition-colors shrink-0"
        onClick={() => navigate(`/${org}/${team}/${project}/issues/${issue.number}`)}
      >
        {issue.key}
      </button>
      <button
        type="button"
        className="text-sm text-text truncate flex-1 text-left hover:text-primary transition-colors"
        onClick={() => navigate(`/${org}/${team}/${project}/issues/${issue.number}`)}
      >
        {issue.title}
      </button>
      {issue.storyPoints != null && (
        <span className="text-[10px] bg-surface-tertiary text-text-secondary px-1.5 py-0.5 rounded-full tabular-nums">
          {issue.storyPoints} SP
        </span>
      )}
      <span
        className={cn('text-[10px] px-1.5 py-0.5 rounded-full', PRIORITY_COLORS[issue.priority])}
      >
        {PRIORITY_LABELS[issue.priority]}
      </span>
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
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-tertiary transition-colors"
                onClick={() => {
                  onRemoveFromSprint(issue.id);
                  setShowMoveMenu(false);
                }}
              >
                Move to Backlog
              </button>
            )}
            {sprints
              .filter((s) => s.status !== 'COMPLETED')
              .map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-tertiary transition-colors"
                  onClick={() => {
                    onMoveToSprint(issue.id, s.id);
                    setShowMoveMenu(false);
                  }}
                >
                  {s.name}
                  <Badge variant={STATUS_BADGE[s.status]} className="ml-2 text-[9px]">
                    {s.status}
                  </Badge>
                </button>
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

function SprintPanel({
  sprint,
  org,
  team,
  project,
  projectId,
  allSprints,
}: {
  sprint: Sprint;
  org: string;
  team: string;
  project: string;
  projectId: string;
  allSprints: Sprint[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState(sprint.status === 'COMPLETED');
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [moveToSprintId, setMoveToSprintId] = useState<string>('');
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState('');

  const startMutation = useMutation({
    mutationFn: () => sprintsApi.start(projectId, sprint.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprints', projectId] });
      toast('Sprint started', 'success');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const completeMutation = useMutation({
    mutationFn: () => sprintsApi.complete(projectId, sprint.id, moveToSprintId || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprints', projectId] });
      queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
      queryClient.invalidateQueries({ queryKey: ['velocity', projectId] });
      setShowCompleteModal(false);
      toast('Sprint completed', 'success');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const addIssuesMutation = useMutation({
    mutationFn: (issueIds: string[]) => sprintsApi.addIssues(projectId, sprint.id, issueIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprints', projectId] });
      queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
    },
  });

  const removeIssueMutation = useMutation({
    mutationFn: (issueId: string) => sprintsApi.removeIssue(projectId, sprint.id, issueId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprints', projectId] });
      queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
    },
  });

  const updateGoalMutation = useMutation({
    mutationFn: (goal: string) => sprintsApi.update(projectId, sprint.id, { goal }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprints', projectId] });
      setEditingGoal(false);
    },
  });

  const totalPoints =
    sprint._storyPoints ?? sprint.issues.reduce((s, i) => s + (i.storyPoints ?? 0), 0);
  const startStr = new Date(sprint.startDate).toLocaleDateString();
  const endStr = new Date(sprint.endDate).toLocaleDateString();

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
    <div
      className="rounded-lg border border-border bg-surface"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={handleDrop}
    >
      {/* Sprint header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-light">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="text-text-secondary hover:text-text"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
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
        {sprint.status === 'ACTIVE' && (
          <Button variant="outline" size="xs" onClick={() => setShowCompleteModal(true)}>
            <CheckCircle2 className="h-3 w-3" /> Complete Sprint
          </Button>
        )}
      </div>

      {/* Sprint goal */}
      {!collapsed && (editingGoal || sprint.goal) && (
        <div className="px-4 py-2 bg-surface-secondary/50 border-b border-border-light text-xs text-text-secondary">
          {editingGoal ? (
            <div className="space-y-2">
              <MarkdownEditor value={goalDraft} onChange={setGoalDraft} compact />
              <div className="flex gap-2">
                <Button
                  size="xs"
                  disabled={updateGoalMutation.isPending}
                  onClick={() => updateGoalMutation.mutate(goalDraft)}
                >
                  <Check className="h-3 w-3" /> Save
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setEditingGoal(false)}>
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
                onClick={() => {
                  setGoalDraft(sprint.goal ?? '');
                  setEditingGoal(true);
                }}
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
    </div>
  );
}

/**
 *
 */
export default function Backlog() {
  const { org, team: teamSlug, project: projectSlug } = useParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSprint, setNewSprint] = useState({
    name: '',
    goal: '',
    startDate: '',
    endDate: '',
  });

  // Resolve project
  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);
  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);
  const { data: projects } = useQuery({
    queryKey: ['projects', currentTeam?.id],
    queryFn: () => projectsApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });
  const currentProject = projects?.find((p) => p.slug === projectSlug);

  const { data: sprints = [], isLoading: sprintsLoading } = useQuery({
    queryKey: ['sprints', currentProject?.id],
    queryFn: () => sprintsApi.list(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const { data: backlogIssues = [], isLoading: backlogLoading } = useQuery({
    queryKey: ['backlog', currentProject?.id],
    queryFn: () => sprintsApi.getBacklog(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const { data: velocityData = [] } = useQuery({
    queryKey: ['velocity', currentProject?.id],
    queryFn: () => sprintsApi.getVelocity(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const createMutation = useMutation({
    mutationFn: () => sprintsApi.create(currentProject!.id, newSprint),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprints', currentProject?.id] });
      setShowCreateModal(false);
      setNewSprint({ name: '', goal: '', startDate: '', endDate: '' });
      toast('Sprint created', 'success');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const addToSprintMutation = useMutation({
    mutationFn: ({ issueId, sprintId }: { issueId: string; sprintId: string }) =>
      sprintsApi.addIssues(currentProject!.id, sprintId, [issueId]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprints', currentProject?.id] });
      queryClient.invalidateQueries({ queryKey: ['backlog', currentProject?.id] });
    },
  });

  const isLoading = sprintsLoading || backlogLoading;
  if (isLoading) return <PageLoader />;

  // Sort sprints: active first, then planning, then completed
  const statusOrder: Record<string, number> = { ACTIVE: 0, PLANNING: 1, COMPLETED: 2 };
  const sortedSprints = [...sprints].sort(
    (a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9),
  );

  const handleBacklogDrop = (e: React.DragEvent) => {
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.issueId && data.sprintId) {
        sprintsApi.removeIssue(currentProject!.id, data.sprintId, data.issueId).then(() => {
          queryClient.invalidateQueries({ queryKey: ['sprints', currentProject?.id] });
          queryClient.invalidateQueries({ queryKey: ['backlog', currentProject?.id] });
        });
      }
    } catch {
      /* ignore */
    }
  };

  const handleIssueDragStart = (e: React.DragEvent, issue: Issue) => {
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({ issueId: issue.id, sprintId: issue.sprintId }),
    );
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text">Backlog</h1>
          <p className="text-sm text-text-secondary">Plan sprints and manage your backlog</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4" /> Create Sprint
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main panel: sprints + backlog */}
        <div className="lg:col-span-2 space-y-4">
          {/* Sprint panels */}
          {sortedSprints.map((sprint) => (
            <SprintPanel
              key={sprint.id}
              sprint={sprint}
              org={org!}
              team={teamSlug!}
              project={projectSlug!}
              projectId={currentProject!.id}
              allSprints={sprints}
            />
          ))}

          {/* Backlog panel */}
          <div
            className="rounded-lg border border-border bg-surface"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={handleBacklogDrop}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border-light">
              <span className="font-medium text-sm">Backlog</span>
              <span className="text-xs text-text-tertiary">
                {backlogIssues.length} issues |{' '}
                {backlogIssues.reduce((s, i) => s + (i.storyPoints ?? 0), 0)} pts
              </span>
            </div>
            <div className="p-2">
              {backlogIssues.length === 0 ? (
                <EmptyState
                  title="Backlog is empty"
                  description="All issues are assigned to sprints."
                />
              ) : (
                backlogIssues.map((issue) => (
                  <div key={issue.id} draggable onDragStart={(e) => handleIssueDragStart(e, issue)}>
                    <IssueRow
                      issue={issue}
                      org={org!}
                      team={teamSlug!}
                      project={projectSlug!}
                      sprints={sprints}
                      onMoveToSprint={(issueId, sprintId) =>
                        addToSprintMutation.mutate({ issueId, sprintId })
                      }
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Sidebar: velocity chart */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface p-4">
            <VelocityChart data={velocityData} />
          </div>

          {/* Sprint summary */}
          <div className="rounded-lg border border-border bg-surface p-4 space-y-2">
            <h3 className="text-sm font-semibold">Sprint Summary</h3>
            {sortedSprints.filter((s) => s.status !== 'COMPLETED').length === 0 ? (
              <p className="text-xs text-text-tertiary">No active or planned sprints.</p>
            ) : (
              sortedSprints
                .filter((s) => s.status !== 'COMPLETED')
                .map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-xs">
                    <span className="text-text truncate">{s.name}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_BADGE[s.status]} className="text-[9px]">
                        {s.status}
                      </Badge>
                      <span className="text-text-tertiary tabular-nums">
                        {s._storyPoints ??
                          s.issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)}{' '}
                        pts
                      </span>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {/* Create Sprint Modal */}
      {showCreateModal && (
        <Modal
          open={showCreateModal}
          title="Create Sprint"
          onClose={() => setShowCreateModal(false)}
        >
          <div className="space-y-4">
            <Input
              label="Sprint Name"
              value={newSprint.name}
              onChange={(e) => setNewSprint({ ...newSprint, name: e.target.value })}
              placeholder="Sprint 1"
            />
            <div>
              <label className="block text-sm font-medium text-text mb-1">
                Sprint Goal (optional)
              </label>
              <MarkdownEditor
                compact
                value={newSprint.goal}
                onChange={(val) => setNewSprint({ ...newSprint, goal: val })}
                placeholder="What do you want to achieve in this sprint?"
                projectId={currentProject?.id}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Start Date"
                type="date"
                value={newSprint.startDate}
                onChange={(e) => setNewSprint({ ...newSprint, startDate: e.target.value })}
              />
              <Input
                label="End Date"
                type="date"
                value={newSprint.endDate}
                onChange={(e) => setNewSprint({ ...newSprint, endDate: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreateModal(false)}>
                <Trash2 className="h-4 w-4" /> Cancel
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!newSprint.name || !newSprint.startDate || !newSprint.endDate}
              >
                <Plus className="h-4 w-4" /> Create Sprint
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
