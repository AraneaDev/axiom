import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Settings } from 'lucide-react';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { Link } from 'react-router';

import { approvalsApi, type ApprovalGate, type ApprovalRequest } from '@/api/approvals.api';
import { issuesApi } from '@/api/issues.api';
import { projectsApi } from '@/api/projects.api';
import { teamsApi } from '@/api/teams.api';
import { ApprovalModal } from '@/components/ui/ApprovalModal';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { BoardSkeleton } from '@/components/ui/Skeleton';
import { useIssueInvalidation } from '@/hooks/useIssueInvalidation';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useProjectContext } from '@/hooks/useProjectContext';
import type { BoardColumn as BoardColumnType } from '@/lib/types';
import { useAuthStore } from '@/stores/auth.store';
import { useUIStore } from '@/stores/ui.store';

import { BoardColorByMenu, BoardColorLegend } from './BoardColorByMenu';
import { BoardColumn } from './BoardColumn';
import type { Filters, GroupBy } from './BoardFilters';
import { BoardFilters, EMPTY_FILTERS } from './BoardFilters';
import { ColumnManager } from './ColumnManager';

/**
 *
 */
export default function Board() {
  const { org, teamSlug, projectSlug, currentProject, currentTeam } = useProjectContext();
  const queryClient = useQueryClient();
  const { invalidateList } = useIssueInvalidation(currentProject?.id ?? '');
  const setPreferredView = useUIStore((s) => s.setPreferredProjectView);
  const currentUser = useAuthStore((s) => s.user);
  useEffect(() => {
    setPreferredView('board');
  }, [setPreferredView]);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const [dragSourceColumnId, setDragSourceColumnId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [showColumnManager, setShowColumnManager] = useState(false);
  const [approvalModalState, setApprovalModalState] = useState<{
    issueId: string;
    issueTitle: string;
    fromColumnName: string;
    toColumnId: string;
    toColumnName: string;
    minApprovals: number;
    allowSelfApproval: boolean;
  } | null>(null);

  const {
    data: columns,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['board', currentProject?.id],
    queryFn: () => issuesApi.getBoard(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  // Approval gates for this project
  const { data: approvalGates } = useQuery({
    queryKey: ['approval-gates', currentProject?.id],
    queryFn: () => approvalsApi.listGates(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  // Pending approval requests for this project
  const { data: pendingRequests } = useQuery({
    queryKey: ['approval-requests-pending', currentProject?.id],
    queryFn: () => approvalsApi.listPendingForProject(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  // Team members for the approval modal
  const { data: teamDetail } = useQuery({
    queryKey: ['team-detail', currentTeam?.id],
    queryFn: () => teamsApi.get(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });

  // Map issueId -> pending request for quick lookup
  const pendingRequestsByIssue = useMemo(() => {
    const map = new Map<string, ApprovalRequest>();
    if (pendingRequests) {
      for (const req of pendingRequests) {
        map.set(req.issueId, req);
      }
    }
    return map;
  }, [pendingRequests]);

  // Set of column IDs that have at least one inbound gate
  const gatedInboundColumnIds = useMemo(() => {
    const set = new Set<string>();
    if (approvalGates) {
      for (const gate of approvalGates) {
        if (gate.enabled) set.add(gate.toColumnId);
      }
    }
    return set;
  }, [approvalGates]);

  // Project members for approval modal
  const projectMembers = useMemo(() => {
    return (teamDetail?.members ?? []).map(
      (m: {
        user: { id: string; username: string; displayName: string; avatarUrl?: string | null };
      }) => ({
        id: m.user.id,
        username: m.user.username,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
      }),
    );
  }, [teamDetail?.members]);

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

  const handleDragStart = useCallback(
    (e: React.DragEvent, issue: { id: string }, columnId: string) => {
      e.dataTransfer.setData(
        'application/json',
        JSON.stringify({ issueId: issue.id, sourceColumnId: columnId }),
      );
      e.dataTransfer.effectAllowed = 'move';
      setDragSourceColumnId(columnId);
    },
    [],
  );

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

        // Check for approval gate
        const gate = approvalGates?.find(
          (g: ApprovalGate) =>
            g.fromColumnId === data.sourceColumnId && g.toColumnId === targetColumnId && g.enabled,
        );
        if (gate) {
          const prevColumns = queryClient.getQueryData<BoardColumnType[]>([
            'board',
            currentProject?.id,
          ]);
          const movedIssue = prevColumns
            ?.flatMap((c) => c.issues)
            .find((i) => i.id === data.issueId);
          const fromCol = prevColumns?.find((c) => c.id === data.sourceColumnId);
          const toCol = prevColumns?.find((c) => c.id === targetColumnId);
          if (movedIssue && fromCol && toCol) {
            setApprovalModalState({
              issueId: movedIssue.id,
              issueTitle: movedIssue.title,
              fromColumnName: fromCol.name,
              toColumnId: targetColumnId,
              toColumnName: toCol.name,
              minApprovals: gate.minApprovals,
              allowSelfApproval: gate.allowSelfApproval,
            });
          }
          return;
        }

        // Optimistic update
        const boardKey = ['board', currentProject?.id];
        const prevColumns = queryClient.getQueryData<BoardColumnType[]>(boardKey);
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
    [currentProject, queryClient, moveMutation, approvalGates],
  );

  if (isLoading) return <BoardSkeleton />;
  if (error) return <div className="p-8 text-center text-danger">Failed to load board data</div>;

  return (
    <div className="">
      <PageHeader title={`${currentProject?.name} Board`} prefix={currentProject?.prefix}>
        <BoardColorByMenu
          cardColorBy={cardColorBy}
          onChangeCardColor={(value) => updateProjectMutation.mutate({ cardColorBy: value })}
        />
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

      <BoardColorLegend cardColorBy={cardColorBy} />

      <div
        className="flex gap-4 overflow-x-auto pb-4"
        onDragLeave={() => setDragOverColumnId(null)}
        onDragEnd={() => {
          setDragOverColumnId(null);
          setDragSourceColumnId(null);
        }}
      >
        {columns?.map((col) => (
          <BoardColumn
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
            pendingRequests={pendingRequestsByIssue}
            isGatedInbound={gatedInboundColumnIds.has(col.id)}
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

      {approvalModalState && currentUser && (
        <ApprovalModal
          open={!!approvalModalState}
          onClose={() => setApprovalModalState(null)}
          issueId={approvalModalState.issueId}
          issueTitle={approvalModalState.issueTitle}
          fromColumnName={approvalModalState.fromColumnName}
          toColumnId={approvalModalState.toColumnId}
          toColumnName={approvalModalState.toColumnName}
          minApprovals={approvalModalState.minApprovals}
          allowSelfApproval={approvalModalState.allowSelfApproval}
          currentUserId={currentUser.id}
          projectMembers={projectMembers}
          onSuccess={() => {
            queryClient.invalidateQueries({
              queryKey: ['approval-requests-pending', currentProject?.id],
            });
          }}
        />
      )}
    </div>
  );
}
