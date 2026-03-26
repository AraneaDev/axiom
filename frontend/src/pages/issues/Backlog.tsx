import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  ArrowRight,
  GripVertical,
  Target,
  ChevronRight,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';

import { SprintCard } from './SprintCard';
import { SprintFormModal } from './SprintFormModal';

import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { sprintsApi } from '@/api/sprints.api';
import { teamsApi } from '@/api/teams.api';
import { BurndownChart } from '@/components/BurndownChart';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { Skeleton, ListSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { VelocityChart } from '@/components/VelocityChart';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '@/lib/constants';
import type { Issue, Sprint } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui.store';

const STATUS_BADGE: Record<string, 'default' | 'primary' | 'success'> = {
  PLANNING: 'default',
  ACTIVE: 'primary',
  COMPLETED: 'success',
};

function BacklogIssueRow({
  issue,
  org,
  team,
  project,
  sprints,
  onMoveToSprint,
}: {
  issue: Issue;
  org: string;
  team: string;
  project: string;
  sprints: Sprint[];
  onMoveToSprint: (issueId: string, sprintId: string) => void;
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

/**
 *
 */
export default function Backlog() {
  const { org, team: teamSlug, project: projectSlug } = useParams();
  const queryClient = useQueryClient();
  const setPreferredView = useUIStore((s) => s.setPreferredProjectView);
  useEffect(() => {
    setPreferredView('backlog');
  }, [setPreferredView]);
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
  if (isLoading)
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <Skeleton className="h-7 w-32 mb-2" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-9 w-36 rounded-md" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <ListSkeleton rows={4} />
            <ListSkeleton rows={6} />
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-surface p-4">
              <Skeleton className="h-40 w-full rounded-md" />
            </div>
          </div>
        </div>
      </div>
    );

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
        <div className="flex gap-2">
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4" /> Create Sprint
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main panel: sprints + backlog */}
        <div className="lg:col-span-2 space-y-4">
          {/* Sprint panels */}
          {sortedSprints.map((sprint) => (
            <SprintCard
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
                    <BacklogIssueRow
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

          {/* Burndown chart for active sprint */}
          {sortedSprints
            .filter((s) => s.status === 'ACTIVE')
            .map((s) => (
              <div key={s.id} className="rounded-lg border border-border bg-surface p-4">
                <BurndownChart sprint={s} />
              </div>
            ))}

          {/* Sprint summary */}
          <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
            <h3 className="text-sm font-semibold">Sprint Summary</h3>
            {sortedSprints.filter((s) => s.status !== 'COMPLETED').length === 0 ? (
              <p className="text-xs text-text-tertiary">No active or planned sprints.</p>
            ) : (
              sortedSprints
                .filter((s) => s.status !== 'COMPLETED')
                .map((s) => {
                  const total = s.issues.length;
                  const done = s.issues.filter((i) => i.column?.isDone).length;
                  const inProgress = s.issues.filter((i) => i.column && !i.column.isDone).length;
                  const todo = total - done - inProgress;
                  const donePct = total > 0 ? (done / total) * 100 : 0;
                  const inProgressPct = total > 0 ? (inProgress / total) * 100 : 0;
                  const todoPct = total > 0 ? (todo / total) * 100 : 0;

                  return (
                    <div key={s.id} className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-text truncate font-medium">{s.name}</span>
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

                      {/* Progress bar */}
                      {total > 0 && (
                        <div className="space-y-1.5">
                          <div className="flex h-2 rounded-full overflow-hidden bg-surface-tertiary">
                            {donePct > 0 && (
                              <div
                                className="bg-success transition-all"
                                style={{ width: `${donePct}%` }}
                              />
                            )}
                            {inProgressPct > 0 && (
                              <div
                                className="bg-primary transition-all"
                                style={{ width: `${inProgressPct}%` }}
                              />
                            )}
                            {todoPct > 0 && (
                              <div
                                className="bg-border transition-all"
                                style={{ width: `${todoPct}%` }}
                              />
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-text-tertiary">
                            <span className="flex items-center gap-1">
                              <span className="inline-block h-2 w-2 rounded-full bg-success" />
                              Done {done}
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                              In Progress {inProgress}
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="inline-block h-2 w-2 rounded-full bg-border" />
                              To Do {todo}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </div>

      {/* Create Sprint Modal */}
      {showCreateModal && (
        <SprintFormModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          sprint={newSprint}
          onSprintChange={setNewSprint}
          onSubmit={() => createMutation.mutate()}
          isSubmitting={createMutation.isPending}
          projectId={currentProject?.id}
        />
      )}
    </div>
  );
}
