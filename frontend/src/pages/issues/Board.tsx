import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Plus, List } from 'lucide-react';
import { issuesApi } from '@/api/issues.api';
import { projectsApi } from '@/api/projects.api';
import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { PageLoader } from '@/components/ui/Spinner';
import { PRIORITY_COLORS } from '@/lib/constants';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { cn } from '@/lib/utils';
import type { BoardColumn, Issue } from '@/lib/types';

function IssueCard({ issue, org, team, project, onDragStart }: { issue: Issue; org: string; team: string; project: string; onDragStart: (e: React.DragEvent, issue: Issue) => void }) {
  return (
    <Link
      to={`/${org}/${team}/${project}/issues/${issue.number}`}
      draggable
      onDragStart={(e) => { e.stopPropagation(); onDragStart(e, issue); }}
      className="block rounded-md border border-border bg-surface p-3 hover:shadow-sm hover:border-primary/30 transition-all cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <IssueTypeIcon type={issue.type} className="h-3.5 w-3.5" />
        <span className="text-xs text-text-secondary font-mono">{issue.key}</span>
        <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${PRIORITY_COLORS[issue.priority]}`}>
          {issue.priority[0]}
        </span>
      </div>
      <p className="text-sm font-medium line-clamp-2 mb-2">{issue.title}</p>
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {issue.labels?.slice(0, 2).map((l) => (
            <span key={l.id} className="text-xs px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary">{l.name}</span>
          ))}
        </div>
        {issue.assignee && <Avatar name={issue.assignee.displayName} size="sm" />}
      </div>
    </Link>
  );
}

function Column({
  column, org, team, project, onDragStart, onDragOver, onDrop, dragOverColumnId,
}: {
  column: BoardColumn; org: string; team: string; project: string;
  onDragStart: (e: React.DragEvent, issue: Issue) => void;
  onDragOver: (e: React.DragEvent, columnId: string) => void;
  onDrop: (e: React.DragEvent, columnId: string) => void;
  dragOverColumnId: string | null;
}) {
  const isOver = dragOverColumnId === column.id;
  return (
    <div className="flex flex-col w-72 shrink-0">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-text">{column.name}</h3>
          <span className="text-xs text-text-secondary bg-surface-tertiary rounded-full px-1.5">{column.issues.length}</span>
        </div>
      </div>
      <div
        onDragOver={(e) => onDragOver(e, column.id)}
        onDrop={(e) => onDrop(e, column.id)}
        className={cn(
          'flex-1 rounded-lg bg-surface-secondary p-2 space-y-2 min-h-[200px] transition-all duration-150',
          column.isDone && 'opacity-60',
          isOver && 'ring-2 ring-primary/40 bg-primary/5',
        )}
      >
        {column.issues.map((issue) => (
          <IssueCard key={issue.id} issue={issue} org={org} team={team} project={project} onDragStart={onDragStart} />
        ))}
      </div>
    </div>
  );
}

export default function Board() {
  const { org, team: teamSlug, project: projectSlug } = useParams();
  const queryClient = useQueryClient();
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

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

  const { data: columns, isLoading } = useQuery({
    queryKey: ['board', currentProject?.id],
    queryFn: () => issuesApi.getBoard(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const moveMutation = useMutation({
    mutationFn: ({ issueId, columnId, position }: { issueId: string; columnId: string; position: number }) =>
      issuesApi.moveIssue(issueId, { columnId, position }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board', currentProject?.id] });
    },
  });

  const handleDragStart = useCallback((e: React.DragEvent, issue: Issue) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ issueId: issue.id, sourceColumnId: issue.column?.id }));
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumnId(columnId);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetColumnId: string) => {
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
            const movedIssue = prevColumns.flatMap((c) => c.issues).find((i) => i.id === data.issueId);
            if (movedIssue) issues.push({ ...movedIssue, column: { id: targetColumnId, name: '' } });
          }
          return { ...col, issues };
        });
        queryClient.setQueryData(boardKey, updated);
      }

      const targetCol = prevColumns?.find((c) => c.id === targetColumnId);
      moveMutation.mutate({ issueId: data.issueId, columnId: targetColumnId, position: targetCol?.issues.length ?? 0 });
    } catch {}
  }, [currentProject?.id, queryClient, moveMutation]);

  if (isLoading) return <PageLoader />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">{currentProject?.name} Board</h1>
          <p className="text-sm text-text-secondary">{currentProject?.prefix}</p>
        </div>
        <div className="flex gap-2">
          <Link to={`/${org}/${teamSlug}/${projectSlug}/issues`}>
            <Button variant="secondary" size="sm"><List className="h-4 w-4" /> List View</Button>
          </Link>
          <Link to={`/${org}/${teamSlug}/${projectSlug}/issues/new`}>
            <Button size="sm"><Plus className="h-4 w-4" /> New Issue</Button>
          </Link>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4" onDragLeave={() => setDragOverColumnId(null)}>
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
          />
        ))}
      </div>
    </div>
  );
}
