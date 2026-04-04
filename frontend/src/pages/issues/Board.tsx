import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ChevronDown, ChevronRight, Settings, Palette } from 'lucide-react';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { Link } from 'react-router';

import type { Filters, GroupBy } from './BoardFilters';
import { BoardFilters, EMPTY_FILTERS } from './BoardFilters';
import { ColumnManager } from './ColumnManager';

import { issuesApi } from '@/api/issues.api';
import { projectsApi } from '@/api/projects.api';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { PageHeader } from '@/components/ui/PageHeader';
import { PriorityBadge } from '@/components/ui/PriorityBadge';
import { BoardSkeleton } from '@/components/ui/Skeleton';
import { useIssueInvalidation } from '@/hooks/useIssueInvalidation';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useProjectContext } from '@/hooks/useProjectContext';
import { PRIORITY_LABELS } from '@/lib/constants';
import type { BoardColumn, Issue } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui.store';

const PRIORITY_CARD_COLORS: Record<string, string> = {
  CRITICAL: 'var(--card-color-critical)',
  HIGH: 'var(--card-color-high)',
  MEDIUM: 'var(--card-color-medium)',
  LOW: 'var(--card-color-low)',
};

const TYPE_CARD_COLORS: Record<string, string> = {
  BUG: 'var(--card-color-bug)',
  STORY: 'var(--card-color-story)',
  TASK: 'var(--card-color-task)',
  EPIC: 'var(--card-color-epic)',
};

const PRIORITY_LEGEND: { key: string; label: string; color: string }[] = [
  { key: 'CRITICAL', label: 'Critical', color: 'var(--card-color-critical)' },
  { key: 'HIGH', label: 'High', color: 'var(--card-color-high)' },
  { key: 'MEDIUM', label: 'Medium', color: 'var(--card-color-medium)' },
  { key: 'LOW', label: 'Low', color: 'var(--card-color-low)' },
];

const TYPE_LEGEND: { key: string; label: string; color: string }[] = [
  { key: 'BUG', label: 'Bug', color: 'var(--card-color-bug)' },
  { key: 'STORY', label: 'Story', color: 'var(--card-color-story)' },
  { key: 'TASK', label: 'Task', color: 'var(--card-color-task)' },
  { key: 'EPIC', label: 'Epic', color: 'var(--card-color-epic)' },
];

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
  columnId,
  onDragStart,
  cardColorBy,
}: {
  issue: Issue;
  org: string;
  team: string;
  project: string;
  columnId: string;
  onDragStart: (e: React.DragEvent, issue: Issue, columnId: string) => void;
  cardColorBy?: string | null;
}) {
  const borderColor =
    cardColorBy === 'priority'
      ? (PRIORITY_CARD_COLORS[issue.priority] ?? undefined)
      : cardColorBy === 'type'
        ? (TYPE_CARD_COLORS[issue.type] ?? undefined)
        : undefined;

  return (
    <Link
      to={`/${org}/${team}/${project}/issues/${issue.number}`}
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        onDragStart(e, issue, columnId);
      }}
      className="block rounded-md border border-border bg-surface p-3 hover:shadow-md hover:border-primary/50 hover:bg-surface-secondary transition-all cursor-grab active:cursor-grabbing"
      style={borderColor ? { borderLeftWidth: '4px', borderLeftColor: borderColor } : undefined}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <IssueTypeIcon type={issue.type} className="h-3.5 w-3.5" />
        <span className="text-xs text-text-secondary font-mono">{issue.key}</span>
        <PriorityBadge priority={issue.priority} display="short" className="ml-auto" />
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
  dragSourceColumnId,
  groupBy,
  filters,
  cardColorBy,
}: {
  column: BoardColumn;
  org: string;
  team: string;
  project: string;
  onDragStart: (e: React.DragEvent, issue: Issue, columnId: string) => void;
  onDragOver: (e: React.DragEvent, columnId: string) => void;
  onDrop: (e: React.DragEvent, columnId: string) => void;
  dragOverColumnId: string | null;
  dragSourceColumnId: string | null;
  groupBy: GroupBy;
  filters: Filters;
  cardColorBy?: string | null;
}) {
  const isOver = dragOverColumnId === column.id;
  const isDragging = dragSourceColumnId !== null;
  const isSource = dragSourceColumnId === column.id;
  const isValidTarget = isDragging && !isSource;
  const filteredIssues = useMemo(
    () => applyFilters(column.issues, filters),
    [column.issues, filters],
  );
  const lanes = useMemo(() => groupIssues(filteredIssues, groupBy), [filteredIssues, groupBy]);
  const isOverWipLimit =
    column.wipLimit !== null &&
    column.wipLimit !== undefined &&
    filteredIssues.length > column.wipLimit;

  return (
    <div className="flex flex-col w-72 shrink-0">
      <div
        className={cn(
          'flex items-center justify-between mb-2 px-1 rounded',
          isOverWipLimit && 'border border-danger bg-danger/5',
        )}
      >
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-text">{column.name}</h3>
          <span
            className={cn(
              'text-xs bg-surface-tertiary rounded-full px-1.5',
              isOverWipLimit ? 'text-danger font-semibold' : 'text-text-secondary',
            )}
          >
            {column.wipLimit != null
              ? `${filteredIssues.length} / ${column.wipLimit}`
              : filteredIssues.length}
          </span>
        </div>
      </div>
      <div
        onDragOver={(e) => onDragOver(e, column.id)}
        onDrop={(e) => onDrop(e, column.id)}
        className={cn(
          'flex-1 rounded-lg bg-surface-secondary p-2 min-h-[200px] transition-all duration-150',
          column.isDone && !isDragging && 'opacity-60',
          isValidTarget &&
            !isOver &&
            'ring-2 ring-primary/30 border-dashed border-2 border-primary/30',
          isOver && 'ring-2 ring-primary bg-primary/10 scale-[1.02] shadow-lg',
          isSource && isDragging && 'opacity-40 scale-[0.98]',
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
                columnId={column.id}
                onDragStart={onDragStart}
                cardColorBy={cardColorBy}
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
  const { org, teamSlug, projectSlug, currentProject } = useProjectContext();
  const queryClient = useQueryClient();
  const { invalidateList } = useIssueInvalidation(currentProject?.id ?? '');
  const setPreferredView = useUIStore((s) => s.setPreferredProjectView);
  useEffect(() => {
    setPreferredView('board');
  }, [setPreferredView]);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const [dragSourceColumnId, setDragSourceColumnId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [showColumnManager, setShowColumnManager] = useState(false);
  const [showColorMenu, setShowColorMenu] = useState(false);

  const {
    data: columns,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['board', currentProject?.id],
    queryFn: () => issuesApi.getBoard(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const cardColorBy = currentProject?.cardColorBy ?? null;

  const updateProjectMutation = useMutationWithToast(
    (data: { cardColorBy?: string | null }) => projectsApi.update(currentProject!.id, data),
    {
      successMessage: null,
      errorMessage: null,
      invalidateKeys: [['project'], ['projects']],
    },
  );

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

  const moveMutation = useMutationWithToast(
    ({
      issueNumber,
      columnId,
      position,
    }: {
      issueNumber: number;
      columnId: string;
      position: number;
    }) => issuesApi.moveIssue(currentProject!.id, issueNumber, { columnId, position }),
    {
      successMessage: null,
      errorMessage: null,
      onSuccess: () => invalidateList(),
    },
  );

  const handleDragStart = useCallback((e: React.DragEvent, issue: Issue, columnId: string) => {
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({ issueId: issue.id, sourceColumnId: columnId }),
    );
    e.dataTransfer.effectAllowed = 'move';
    setDragSourceColumnId(columnId);
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
      setDragSourceColumnId(null);
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
  if (error) return <div className="p-8 text-center text-danger">Failed to load board data</div>;

  return (
    <div className="px-6 py-4">
      <PageHeader title={`${currentProject?.name} Board`} prefix={currentProject?.prefix}>
        <div className="relative">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowColorMenu((o) => !o)}
            className={cardColorBy ? 'border-primary text-primary' : ''}
          >
            <Palette className="h-4 w-4" /> Color by
          </Button>
          {showColorMenu && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-surface border border-border rounded-md shadow-md py-1 min-w-[140px] animate-slide-down">
              {[
                { value: null, label: 'None' },
                { value: 'priority', label: 'Priority' },
                { value: 'type', label: 'Type' },
              ].map((opt) => (
                <Button
                  key={opt.value ?? 'none'}
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    updateProjectMutation.mutate({ cardColorBy: opt.value });
                    setShowColorMenu(false);
                  }}
                  className={cn(
                    'w-full justify-start rounded-none px-3 py-1.5',
                    cardColorBy === opt.value && 'text-primary font-semibold',
                  )}
                >
                  <Palette className="h-3.5 w-3.5" />
                  {opt.label}
                </Button>
              ))}
            </div>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={() => setShowColumnManager(true)}>
          <Settings className="h-4 w-4" /> Columns
        </Button>
        <Link to={`/${org}/${teamSlug}/${projectSlug}/issues/new`}>
          <Button size="sm">
            <Plus className="h-4 w-4" /> New Issue
          </Button>
        </Link>
      </PageHeader>

      <BoardFilters
        filters={filters}
        onFiltersChange={setFilters}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        allAssignees={allAssignees}
        allLabels={allLabels}
      />

      {cardColorBy && (
        <div className="flex items-center gap-3 mb-2 px-1">
          <span className="text-xs text-text-secondary font-medium">Color by {cardColorBy}:</span>
          {(cardColorBy === 'priority' ? PRIORITY_LEGEND : TYPE_LEGEND).map((item) => (
            <div key={item.key} className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-xs text-text-secondary">{item.label}</span>
            </div>
          ))}
        </div>
      )}

      <div
        className="flex gap-4 overflow-x-auto pb-4"
        onDragLeave={() => setDragOverColumnId(null)}
        onDragEnd={() => {
          setDragOverColumnId(null);
          setDragSourceColumnId(null);
        }}
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
            dragSourceColumnId={dragSourceColumnId}
            groupBy={groupBy}
            filters={filters}
            cardColorBy={cardColorBy}
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
