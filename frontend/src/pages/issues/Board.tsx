import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ChevronDown, ChevronRight, Settings } from 'lucide-react';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { Link, useParams } from 'react-router';

import { BoardFilters, EMPTY_FILTERS } from './BoardFilters';
import type { Filters, GroupBy } from './BoardFilters';
import { ColumnManager } from './ColumnManager';

import { issuesApi } from '@/api/issues.api';
import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { teamsApi } from '@/api/teams.api';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { BoardSkeleton } from '@/components/ui/Skeleton';
import { PRIORITY_COLORS, PRIORITY_LABELS, STABLE_STALE_TIME } from '@/lib/constants';
import type { BoardColumn, Issue } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui.store';

function applyFilters(issues: Issue[], filters: Filters): Issue[] {
  let result = issues;
  if (filters.assignee.length > 0)
    result = result.filter((i) => i.assignee && filters.assignee.includes(i.assignee.id));
  if (filters.priority.length > 0)
    result = result.filter((i) => filters.priority.includes(i.priority));
  if (filters.label.length > 0)
    result = result.filter((i) => i.labels?.some((l) => filters.label.includes(l.id)));
  if (filters.type.length > 0) result = result.filter((i) => filters.type.includes(i.type));
  return result;
}

interface SwimLane {
  key: string;
  label: string;
  issues: Issue[];
}

function groupIssues(issues: Issue[], groupBy: GroupBy): SwimLane[] {
  if (groupBy === 'none') return [{ key: '__all', label: '', issues }];

  const groups = new Map<string, { label: string; issues: Issue[] }>();

  for (const issue of issues) {
    let key: string;
    let label: string;

    switch (groupBy) {
      case 'assignee':
        key = issue.assignee?.id ?? '__unassigned';
        label = issue.assignee?.displayName ?? 'Unassigned';
        break;
      case 'priority':
        key = issue.priority;
        label = PRIORITY_LABELS[issue.priority as keyof typeof PRIORITY_LABELS] ?? issue.priority;
        break;
      case 'epic':
        key = issue.parentId ?? '__no-epic';
        label = issue.parent?.title ?? 'No Epic';
        break;
      default:
        key = '__all';
        label = '';
    }

    if (!groups.has(key)) groups.set(key, { label, issues: [] });
    groups.get(key)!.issues.push(issue);
  }

  return Array.from(groups.entries()).map(([key, val]) => ({
    key,
    label: val.label,
    issues: val.issues,
  }));
}

function IssueCard({
  issue,
  org,
  team,
  project,
  onDragStart,
}: {
  issue: Issue;
  org: string;
  team: string;
  project: string;
  onDragStart: (e: React.DragEvent, issue: Issue) => void;
}) {
  return (
    <Link
      to={`/${org}/${team}/${project}/issues/${issue.number}`}
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        onDragStart(e, issue);
      }}
      className="block rounded-md border border-border bg-surface p-3 hover:shadow-md hover:border-primary/50 hover:bg-surface-secondary transition-all cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <IssueTypeIcon type={issue.type} className="h-3.5 w-3.5" />
        <span className="text-xs text-text-secondary font-mono">{issue.key}</span>
        <span
          className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${PRIORITY_COLORS[issue.priority]}`}
        >
          {issue.priority[0]}
        </span>
      </div>
      <p className="text-sm font-medium line-clamp-2 mb-2">{issue.title}</p>
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {issue.labels?.slice(0, 2).map((l) => (
            <span
              key={l.id}
              className="text-xs px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary"
            >
              {l.name}
            </span>
          ))}
        </div>
        {issue.assignee && <Avatar name={issue.assignee.displayName} size="sm" />}
      </div>
    </Link>
  );
}

function SwimLaneSection({
  lane,
  children,
  defaultOpen,
}: {
  lane: SwimLane;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);

  if (!lane.label) return <>{children}</>;

  return (
    <div className="mb-2">
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1 px-1 hover:text-text w-full justify-start"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {lane.label}
        <span className="text-text-tertiary font-normal ml-1">({lane.issues.length})</span>
      </Button>
      {open && <div className="space-y-2">{children}</div>}
    </div>
  );
}

function Column({
  column,
  org,
  team,
  project,
  onDragStart,
  onDragOver,
  onDrop,
  dragOverColumnId,
  groupBy,
  filters,
}: {
  column: BoardColumn;
  org: string;
  team: string;
  project: string;
  onDragStart: (e: React.DragEvent, issue: Issue) => void;
  onDragOver: (e: React.DragEvent, columnId: string) => void;
  onDrop: (e: React.DragEvent, columnId: string) => void;
  dragOverColumnId: string | null;
  groupBy: GroupBy;
  filters: Filters;
}) {
  const isOver = dragOverColumnId === column.id;
  const filteredIssues = useMemo(
    () => applyFilters(column.issues, filters),
    [column.issues, filters],
  );
  const lanes = useMemo(() => groupIssues(filteredIssues, groupBy), [filteredIssues, groupBy]);

  return (
    <div className="flex flex-col w-72 shrink-0">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-text">{column.name}</h3>
          <span className="text-xs text-text-secondary bg-surface-tertiary rounded-full px-1.5">
            {filteredIssues.length}
          </span>
        </div>
      </div>
      <div
        onDragOver={(e) => onDragOver(e, column.id)}
        onDrop={(e) => onDrop(e, column.id)}
        className={cn(
          'flex-1 rounded-lg bg-surface-secondary p-2 min-h-[200px] transition-all duration-150',
          column.isDone && 'opacity-60',
          isOver && 'ring-2 ring-primary/40 bg-primary/5',
        )}
      >
        {lanes.map((lane) => (
          <SwimLaneSection key={lane.key} lane={lane}>
            {lane.issues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                org={org}
                team={team}
                project={project}
                onDragStart={onDragStart}
              />
            ))}
          </SwimLaneSection>
        ))}
      </div>
    </div>
  );
}

/**
 *
 */
export default function Board() {
  const { org, team: teamSlug, project: projectSlug } = useParams();
  const queryClient = useQueryClient();
  const setPreferredView = useUIStore((s) => s.setPreferredProjectView);
  useEffect(() => {
    setPreferredView('board');
  }, [setPreferredView]);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [showColumnManager, setShowColumnManager] = useState(false);

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
  });
  const currentProject = projects?.find((p) => p.slug === projectSlug);

  const { data: columns, isLoading } = useQuery({
    queryKey: ['board', currentProject?.id],
    queryFn: () => issuesApi.getBoard(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  // Extract unique assignees and labels from all board issues
  const allIssues = useMemo(() => columns?.flatMap((c) => c.issues) ?? [], [columns]);

  const allAssignees = useMemo(() => {
    const map = new Map<string, { id: string; displayName: string }>();
    for (const issue of allIssues) {
      if (issue.assignee) map.set(issue.assignee.id, issue.assignee);
    }
    return Array.from(map.values());
  }, [allIssues]);

  const allLabels = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const issue of allIssues) {
      for (const label of issue.labels ?? []) map.set(label.id, label);
    }
    return Array.from(map.values());
  }, [allIssues]);

  const moveMutation = useMutation({
    mutationFn: ({
      issueNumber,
      columnId,
      position,
    }: {
      issueNumber: number;
      columnId: string;
      position: number;
    }) => issuesApi.moveIssue(currentProject!.id, issueNumber, { columnId, position }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board', currentProject?.id] });
    },
  });

  const handleDragStart = useCallback((e: React.DragEvent, issue: Issue) => {
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({ issueId: issue.id, sourceColumnId: issue.column?.id }),
    );
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumnId(columnId);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetColumnId: string) => {
      e.preventDefault();
      setDragOverColumnId(null);
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'));
        if (data.sourceColumnId === targetColumnId) return;

        // Optimistic update
        const boardKey = ['board', currentProject?.id];
        const prevColumns = queryClient.getQueryData<BoardColumn[]>(boardKey);
        if (prevColumns) {
          const updated = prevColumns.map((col) => {
            const issues = col.issues.filter((i) => i.id !== data.issueId);
            if (col.id === targetColumnId) {
              const movedIssue = prevColumns
                .flatMap((c) => c.issues)
                .find((i) => i.id === data.issueId);
              if (movedIssue)
                issues.push({ ...movedIssue, column: { id: targetColumnId, name: '' } });
            }
            return { ...col, issues };
          });
          queryClient.setQueryData(boardKey, updated);
        }

        const targetCol = prevColumns?.find((c) => c.id === targetColumnId);
        const movedIssue = prevColumns?.flatMap((c) => c.issues).find((i) => i.id === data.issueId);
        moveMutation.mutate({
          issueNumber: movedIssue?.number ?? 0,
          columnId: targetColumnId,
          position: targetCol?.issues.length ?? 0,
        });
      } catch {
        /* ignore invalid drag data */
      }
    },
    [currentProject, queryClient, moveMutation],
  );

  if (isLoading) return <BoardSkeleton />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-text">Board</h1>
          {currentProject?.prefix && (
            <span className="text-xs font-mono font-medium text-text-tertiary bg-surface-tertiary px-2 py-1 rounded">
              {currentProject.prefix}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowColumnManager(true)}>
            <Settings className="h-4 w-4" /> Columns
          </Button>
          <Link to={`/${org}/${teamSlug}/${projectSlug}/issues/new`}>
            <Button size="sm">
              <Plus className="h-4 w-4" /> New Issue
            </Button>
          </Link>
        </div>
      </div>

      <BoardFilters
        filters={filters}
        onFiltersChange={setFilters}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        allAssignees={allAssignees}
        allLabels={allLabels}
      />

      <div
        className="flex gap-4 overflow-x-auto pb-4"
        onDragLeave={() => setDragOverColumnId(null)}
      >
        {columns?.map((col) => (
          <Column
            key={col.id}
            column={col}
            org={org!}
            team={teamSlug!}
            project={projectSlug!}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            dragOverColumnId={dragOverColumnId}
            groupBy={groupBy}
            filters={filters}
          />
        ))}
      </div>

      {columns && currentProject && (
        <ColumnManager
          open={showColumnManager}
          onClose={() => setShowColumnManager(false)}
          projectId={currentProject.id}
          columns={columns}
        />
      )}
    </div>
  );
}
