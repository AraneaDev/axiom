import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Download, AlertTriangle } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { getBlob } from '@/api/client';
import { hydrateApi } from '@/api/hydrate.api';
import { issuesApi } from '@/api/issues.api';
import { savedFiltersApi } from '@/api/saved-filters.api';
import { sprintsApi } from '@/api/sprints.api';
import { teamsApi } from '@/api/teams.api';
import { PageLayout } from '@/components/layout/PageLayout';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useIssueListFilters } from '@/hooks/useIssueListFilters';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useProjectContext } from '@/hooks/useProjectContext';
import { useUIStore } from '@/stores/ui.store';

import { IssueListBulkActions } from './IssueListBulkActions';
import { IssueListFilters } from './IssueListFilters';
import { IssueListSaveFilterModal } from './IssueListSaveFilterModal';
import { IssueListSidebar } from './IssueListSidebar';
import { IssueListTable } from './IssueListTable';
import { IssueListToolbar } from './IssueListToolbar';

/**
 *
 */
export default function IssueList() {
  const { org, teamSlug, projectSlug, currentTeam, currentProject } = useProjectContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const setPreferredView = useUIStore((s) => s.setPreferredProjectView);
  useEffect(() => {
    setPreferredView('issues');
  }, [setPreferredView]);

  // Pagination state from URL
  const pageLimit = parseInt(searchParams.get('limit') || '25');
  const pageOffset = parseInt(searchParams.get('offset') || '0');

  const filterString = searchParams.toString();
  const queryParams: Record<string, string> = useMemo(() => {
    const f: Record<string, string> = {};
    for (const [k, v] of searchParams.entries()) f[k] = v;
    return f;
  }, [searchParams]);

  // Hydration: single request for all issues list data
  const hydrationQuery = useQuery({
    queryKey: ['issues-list-hydrate', currentProject?.id, filterString],
    queryFn: () => hydrateApi.issuesList(currentProject!.id, queryParams),
    enabled: !!currentProject?.id,
    retry: 1,
    staleTime: 30_000,
  });

  // Seed individual caches from hydration response
  const hydrationMappings = useMemo(
    () => [
      { key: ['issues', currentProject?.id, queryParams], field: 'issues' as const },
      { key: ['board', currentProject?.id], field: 'boardColumns' as const },
      { key: ['sprints', currentProject?.id], field: 'sprints' as const },
      { key: ['saved-filters', currentProject?.id], field: 'savedFilters' as const },
    ],
    [currentProject?.id, queryParams],
  );

  useEffect(() => {
    if (!hydrationQuery.data) return;
    const hd = hydrationQuery.data;
    for (const { key, field } of hydrationMappings) {
      const value = hd[field];
      if (value !== null && value !== undefined) {
        queryClient.setQueryData(key, value);
      }
    }
  }, [hydrationQuery.data, hydrationMappings, queryClient]);

  const hydrated = !!hydrationQuery.data;

  const {
    data,
    isLoading,
    error: issuesError,
  } = useQuery({
    queryKey: ['issues', currentProject?.id, queryParams],
    queryFn: () => issuesApi.list(currentProject!.id, queryParams),
    enabled: !!currentProject?.id && !hydrated,
  });

  // Board columns for bulk status change
  const { data: boardColumns = [] } = useQuery({
    queryKey: ['board', currentProject?.id],
    queryFn: () => issuesApi.getBoard(currentProject!.id),
    enabled: !!currentProject?.id && !hydrated,
  });

  // Team members for bulk assign (not in hydration -- always independent)
  const { data: teamDetail } = useQuery({
    queryKey: ['team-detail', currentTeam?.id],
    queryFn: () => teamsApi.get(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });

  // Sprints for bulk sprint move
  const { data: sprints = [] } = useQuery({
    queryKey: ['sprints', currentProject?.id],
    queryFn: () => sprintsApi.list(currentProject!.id),
    enabled: !!currentProject?.id && !hydrated,
  });

  // Use extracted filter/sort/search hook
  const {
    filters,
    setFilter,
    clearFilters,
    showFilters,
    setShowFilters,
    sortField,
    sortDir,
    toggleSort,
    viewMode,
    setViewMode,
    searchInput,
    searchQuery,
    handleSearchChange,
    clearSearch,
    hasActiveSearch,
    filteredIssues,
    activeFilterCount,
    allAssignees,
    allLabels,
  } = useIssueListFilters(data?.issues ?? []);

  // Saved filters
  const [showSaveFilterModal, setShowSaveFilterModal] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState('');

  const { data: savedFilters = [] } = useQuery({
    queryKey: ['saved-filters', currentProject?.id],
    queryFn: () => savedFiltersApi.list(currentProject?.id),
    enabled: !!currentProject?.id && !hydrated,
  });

  const saveFilterMutation = useMutationWithToast(
    (d: { name: string; query: Record<string, string>; projectId?: string }) =>
      savedFiltersApi.create(d),
    {
      successMessage: null,
      errorMessage: null,
      invalidateKeys: [['saved-filters', currentProject?.id]],
      onSuccess: () => {
        setShowSaveFilterModal(false);
        setSaveFilterName('');
      },
    },
  );

  const deleteFilterMutation = useMutationWithToast(
    (filterId: string) => savedFiltersApi.delete(filterId),
    {
      successMessage: null,
      errorMessage: null,
      invalidateKeys: [['saved-filters', currentProject?.id]],
    },
  );

  // Issue preview sidebar state
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredIssues.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredIssues.map((i) => i.id)));
    }
  };

  const bulkMutation = useMutationWithToast(
    (d: {
      issueIds: string[];
      updates: {
        status?: string;
        assigneeId?: string | null;
        priority?: string;
        sprintId?: string | null;
      };
    }) => issuesApi.bulkUpdate(currentProject!.id, d),
    {
      successMessage: null,
      errorMessage: null,
      invalidateKeys: [
        ['issues', currentProject?.id],
        ['board', currentProject?.id],
      ],
      onSuccess: () => setSelectedIds(new Set()),
    },
  );

  const bulkDeleteMutation = useMutationWithToast(
    async (ids: string[]) => {
      const issuesData = data?.issues ?? [];
      for (const id of ids) {
        const issue = issuesData.find((i) => i.id === id);
        if (issue) {
          await issuesApi.delete(currentProject!.id, issue.number);
        }
      }
    },
    {
      successMessage: null,
      errorMessage: null,
      invalidateKeys: [
        ['issues', currentProject?.id],
        ['board', currentProject?.id],
      ],
      onSuccess: () => {
        setSelectedIds(new Set());
        setShowDeleteConfirm(false);
      },
    },
  );

  const hasSelection = selectedIds.size > 0;

  const queryError = hydrationQuery.error || issuesError;

  // Build issue preview sidebar
  const allIssues = data?.issues ?? [];
  const selectedIssue = selectedIssueId
    ? (allIssues.find((i) => i.id === selectedIssueId) ?? null)
    : null;

  const issueSidebar = (
    <IssueListSidebar
      selectedIssue={selectedIssue}
      allIssues={allIssues}
      onClose={() => setSelectedIssueId(null)}
      issueUrl={(num) => `/${org}/${teamSlug}/${projectSlug}/issues/${num}`}
    />
  );

  if (isLoading || !currentProject)
    return (
      <PageLayout>
        <div className="flex items-center justify-between mb-4">
          <h1 className="h2">Issues</h1>
        </div>
        <ListSkeleton rows={8} />
      </PageLayout>
    );

  if (queryError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load issues</p>
        </div>
      </div>
    );
  }

  const handleSaveFilter = () => {
    if (!saveFilterName.trim()) return;
    const query: Record<string, string> = {};
    for (const [k, v] of searchParams.entries()) query[k] = v;
    if (searchQuery.trim()) query.search = searchQuery.trim();
    if (filters.type.length) query.type = filters.type.join(',');
    if (filters.priority.length) query.priority = filters.priority.join(',');
    if (filters.assignee.length) query.assignee = filters.assignee.join(',');
    if (filters.label.length) query.label = filters.label.join(',');
    if (sortField !== 'createdAt') query.sort = sortField;
    if (sortDir !== 'desc') query.dir = sortDir;
    saveFilterMutation.mutate({
      name: saveFilterName.trim(),
      query,
      projectId: currentProject?.id,
    });
  };

  return (
    <PageLayout sidebar={issueSidebar}>
      <PageHeader title={`${currentProject?.name} Issues`} prefix={currentProject?.prefix}>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            const blob = await getBlob(`/api/projects/${currentProject!.id}/issues/export`, {
              headers: { 'X-Requested-With': 'XMLHttpRequest' },
            }).catch(() => null);
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'issues.csv';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download className="h-4 w-4" /> Export CSV
        </Button>
        <ButtonLink to={`/${org}/${teamSlug}/${projectSlug}/issues/new`} size="sm">
          <Plus className="h-4 w-4" /> New Issue
        </ButtonLink>
      </PageHeader>

      <IssueListToolbar
        searchInput={searchInput}
        onSearchChange={handleSearchChange}
        onClearSearch={clearSearch}
        hasActiveSearch={hasActiveSearch}
        onToggleFilters={() => setShowFilters(!showFilters)}
        activeFilterCount={activeFilterCount}
        sortField={sortField}
        sortDir={sortDir}
        onToggleSort={toggleSort}
        viewMode={viewMode}
        onSetViewMode={setViewMode}
        savedFilters={savedFilters}
        onApplySavedFilter={(query) => {
          const params = new URLSearchParams(query);
          setSearchParams(params);
        }}
        onDeleteSavedFilter={(id) => deleteFilterMutation.mutate(id)}
        onSaveFilter={() => setShowSaveFilterModal(true)}
        canSaveFilter={activeFilterCount > 0 || hasActiveSearch}
      />

      {/* Bulk action toolbar */}
      {hasSelection && (
        <IssueListBulkActions
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          showDeleteConfirm={showDeleteConfirm}
          setShowDeleteConfirm={setShowDeleteConfirm}
          boardColumns={boardColumns}
          teamMembers={teamDetail?.members ?? []}
          sprints={sprints}
          onBulkUpdate={(d) => bulkMutation.mutate(d)}
          onBulkDelete={(ids) => bulkDeleteMutation.mutate(ids)}
          isBulkDeletePending={bulkDeleteMutation.isPending}
        />
      )}

      {/* Filter bar */}
      {showFilters && (
        <IssueListFilters
          filters={filters}
          setFilter={setFilter}
          clearFilters={clearFilters}
          allAssignees={allAssignees}
          allLabels={allLabels}
          allSprints={sprints}
          allColumns={boardColumns.map((c) => ({ id: c.id, name: c.name }))}
          activeFilterCount={activeFilterCount}
        />
      )}

      <IssueListTable
        issues={filteredIssues}
        selectedIds={selectedIds}
        toggleSelect={toggleSelect}
        toggleSelectAll={toggleSelectAll}
        viewMode={viewMode}
        hasActiveSearch={hasActiveSearch}
        activeFilterCount={activeFilterCount}
        org={org!}
        teamSlug={teamSlug!}
        projectSlug={projectSlug!}
        onIssueClick={(id) => setSelectedIssueId((prev) => (prev === id ? null : id))}
        selectedIssueId={selectedIssueId}
      />

      {/* Pagination */}
      {(data?.total ?? 0) > 0 && (
        <Pagination
          total={data?.total ?? 0}
          limit={pageLimit}
          offset={pageOffset}
          onPageChange={(newOffset) => {
            const params = new URLSearchParams(searchParams);
            params.set('offset', String(newOffset));
            if (!params.has('limit')) params.set('limit', String(pageLimit));
            setSearchParams(params);
          }}
          onLimitChange={(newLimit) => {
            const params = new URLSearchParams(searchParams);
            params.set('limit', String(newLimit));
            params.set('offset', '0');
            setSearchParams(params);
          }}
        />
      )}

      <IssueListSaveFilterModal
        open={showSaveFilterModal}
        onClose={() => setShowSaveFilterModal(false)}
        filterName={saveFilterName}
        onFilterNameChange={setSaveFilterName}
        onSave={handleSaveFilter}
        isSaving={saveFilterMutation.isPending}
      />
    </PageLayout>
  );
}
