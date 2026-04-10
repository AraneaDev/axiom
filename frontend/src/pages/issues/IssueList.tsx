import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Filter,
  ArrowUpDown,
  LayoutList,
  LayoutGrid,
  Download,
  X,
  Search,
  Bookmark,
  BookmarkCheck,
  AlertTriangle,
  ExternalLink,
  CircleDot,
  CircleCheck,
} from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';

import { IssueListBulkActions } from './IssueListBulkActions';
import { IssueListFilters } from './IssueListFilters';
import { IssueListTable } from './IssueListTable';

import { fetchWithAuth } from '@/api/client';
import { hydrateApi } from '@/api/hydrate.api';
import { issuesApi } from '@/api/issues.api';
import { savedFiltersApi } from '@/api/saved-filters.api';
import { sprintsApi } from '@/api/sprints.api';
import { teamsApi } from '@/api/teams.api';
import { PageLayout } from '@/components/layout/PageLayout';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { PriorityBadge } from '@/components/ui/PriorityBadge';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useIssueListFilters } from '@/hooks/useIssueListFilters';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useProjectContext } from '@/hooks/useProjectContext';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui.store';

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
  const filters: Record<string, string> = useMemo(() => {
    const f: Record<string, string> = {};
    for (const [k, v] of searchParams.entries()) f[k] = v;
    return f;
  }, [searchParams]);

  // Hydration: single request for all issues list data
  const hydrationQuery = useQuery({
    queryKey: ['issues-list-hydrate', currentProject?.id, filterString],
    queryFn: () => hydrateApi.issuesList(currentProject!.id, filters),
    enabled: !!currentProject?.id,
    retry: 1,
    staleTime: 30_000,
  });

  // Seed individual caches from hydration response
  const hydrationMappings = useMemo(
    () => [
      { key: ['issues', currentProject?.id, filters], field: 'issues' as const },
      { key: ['board', currentProject?.id], field: 'boardColumns' as const },
      { key: ['sprints', currentProject?.id], field: 'sprints' as const },
      { key: ['saved-filters', currentProject?.id], field: 'savedFilters' as const },
    ],
    [currentProject?.id, filters],
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
    queryKey: ['issues', currentProject?.id, filters],
    queryFn: () => issuesApi.list(currentProject!.id, filters),
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
    typeFilter,
    setTypeFilter,
    priorityFilter,
    setPriorityFilter,
    assigneeFilter,
    setAssigneeFilter,
    labelFilter,
    setLabelFilter,
    sprintFilter,
    setSprintFilter,
    columnFilter,
    setColumnFilter,
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

  const openCount = allIssues.filter(
    (i) => i.column?.name !== 'Done' && i.column?.name !== 'Closed',
  ).length;
  const closedCount = allIssues.length - openCount;

  const issueSidebar = selectedIssue ? (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-sm text-text truncate">Issue Preview</h3>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setSelectedIssueId(null)}
          title="Close preview"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="p-4 space-y-4">
        <div className="flex items-start gap-2">
          <IssueTypeIcon type={selectedIssue.type} className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <span className="text-xs font-mono text-text-secondary">{selectedIssue.key}</span>
            <h4 className="text-sm font-medium text-text leading-snug">{selectedIssue.title}</h4>
          </div>
        </div>

        <div className="space-y-2">
          {selectedIssue.column && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-tertiary">Status</span>
              <Badge variant="outline" size="sm">
                {selectedIssue.column.name}
              </Badge>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-text-tertiary">Priority</span>
            <PriorityBadge priority={selectedIssue.priority} />
          </div>

          {selectedIssue.assignee && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-tertiary">Assignee</span>
              <div className="flex items-center gap-1.5">
                <Avatar name={selectedIssue.assignee.displayName} size="xs" />
                <span className="text-xs text-text">{selectedIssue.assignee.displayName}</span>
              </div>
            </div>
          )}

          {selectedIssue.labels && selectedIssue.labels.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-tertiary">Labels</span>
              <div className="flex items-center gap-1 flex-wrap justify-end">
                {selectedIssue.labels.map((l) => (
                  <Badge key={l.id} variant="outline" size="sm">
                    {l.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        <Link
          to={`/${org}/${teamSlug}/${projectSlug}/issues/${selectedIssue.number}`}
          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover mt-2"
        >
          <ExternalLink className="h-3 w-3" /> View full details
        </Link>
      </div>
    </Card>
  ) : (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-sm text-text">Summary</h3>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-tertiary">Total Issues</span>
          <span className="text-sm font-medium text-text">{allIssues.length}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CircleDot className="h-3 w-3 text-success" />
            <span className="text-xs text-text-tertiary">Open</span>
          </div>
          <span className="text-sm font-medium text-text">{openCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CircleCheck className="h-3 w-3 text-text-tertiary" />
            <span className="text-xs text-text-tertiary">Closed</span>
          </div>
          <span className="text-sm font-medium text-text">{closedCount}</span>
        </div>
        <p className="text-xs text-text-tertiary pt-2 border-t border-border">
          Click an issue row to preview it here
        </p>
      </div>
    </Card>
  );

  if (isLoading)
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

  return (
    <PageLayout sidebar={issueSidebar}>
      <PageHeader title={`${currentProject?.name} Issues`} prefix={currentProject?.prefix}>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            const res = await fetchWithAuth(`/api/projects/${currentProject!.id}/issues/export`, {
              headers: { 'X-Requested-With': 'XMLHttpRequest' },
            });
            const blob = await res.blob();
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
        <Link to={`/${org}/${teamSlug}/${projectSlug}/issues/new`}>
          <Button size="sm">
            <Plus className="h-4 w-4" /> New Issue
          </Button>
        </Link>
      </PageHeader>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4 bg-surface rounded-lg border border-border p-2">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary pointer-events-none" />
          <Input
            placeholder="Search issues..."
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-8 py-1.5 text-sm h-8"
          />
          {hasActiveSearch && (
            <Button
              variant="ghost"
              size="xs"
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text p-0.5"
              title="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <Button variant="secondary" size="sm" onClick={() => setShowFilters(!showFilters)}>
          <Filter className="h-3.5 w-3.5" /> Filters
          {activeFilterCount > 0 && (
            <span className="ml-1 bg-primary text-on-primary text-[10px] rounded-full px-1.5 py-0.5">
              {activeFilterCount}
            </span>
          )}
        </Button>

        {/* Sort dropdown */}
        <Dropdown
          trigger={
            <Button variant="secondary" size="sm">
              <ArrowUpDown className="h-3.5 w-3.5" /> Sort
            </Button>
          }
        >
          {(
            [
              ['createdAt', 'Created'],
              ['updatedAt', 'Updated'],
              ['priority', 'Priority'],
            ] as const
          ).map(([field, label]) => (
            <DropdownItem
              key={field}
              onClick={() => toggleSort(field)}
              className={cn('justify-between', sortField === field && 'text-primary font-medium')}
            >
              <ArrowUpDown className="h-3 w-3" /> {label}
              {sortField === field && (
                <span className="text-xs">{sortDir === 'asc' ? 'Asc' : 'Desc'}</span>
              )}
            </DropdownItem>
          ))}
        </Dropdown>

        {/* Saved filters dropdown */}
        <Dropdown
          trigger={
            <Button variant="secondary" size="sm">
              <BookmarkCheck className="h-3.5 w-3.5" /> Saved
              {savedFilters.length > 0 && (
                <span className="ml-1 bg-surface-tertiary text-text-secondary text-[10px] rounded-full px-1.5 py-0.5">
                  {savedFilters.length}
                </span>
              )}
            </Button>
          }
        >
          {savedFilters.length === 0 ? (
            <p className="px-3 py-2 text-xs text-text-tertiary">No saved filters</p>
          ) : (
            savedFilters.map((sf) => (
              <div key={sf.id} className="flex items-center group">
                <DropdownItem
                  onClick={() => {
                    const params = new URLSearchParams(sf.query as Record<string, string>);
                    setSearchParams(params);
                  }}
                  className="flex-1 justify-start"
                >
                  <Bookmark className="h-3 w-3 text-primary shrink-0" />
                  <span className="truncate">{sf.name}</span>
                </DropdownItem>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteFilterMutation.mutate(sf.id);
                  }}
                  className="px-2 py-1 text-text-tertiary hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete saved filter"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))
          )}
        </Dropdown>

        {/* Save current filter */}
        {(activeFilterCount > 0 || hasActiveSearch) && (
          <Button variant="secondary" size="sm" onClick={() => setShowSaveFilterModal(true)}>
            <Bookmark className="h-3.5 w-3.5" /> Save Filter
          </Button>
        )}

        <div className="ml-auto flex items-center gap-1 rounded-lg border border-border p-0.5">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setViewMode('list')}
            className={cn(
              'p-1',
              viewMode === 'list'
                ? 'bg-surface-tertiary text-text'
                : 'text-text-tertiary hover:text-text',
            )}
            title="List view"
          >
            <LayoutList className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setViewMode('grid')}
            className={cn(
              'p-1',
              viewMode === 'grid'
                ? 'bg-surface-tertiary text-text'
                : 'text-text-tertiary hover:text-text',
            )}
            title="Grid view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

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
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          priorityFilter={priorityFilter}
          setPriorityFilter={setPriorityFilter}
          assigneeFilter={assigneeFilter}
          setAssigneeFilter={setAssigneeFilter}
          labelFilter={labelFilter}
          setLabelFilter={setLabelFilter}
          sprintFilter={sprintFilter}
          setSprintFilter={setSprintFilter}
          columnFilter={columnFilter}
          setColumnFilter={setColumnFilter}
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

      {/* Save Filter Modal */}
      <Modal
        open={showSaveFilterModal}
        onClose={() => setShowSaveFilterModal(false)}
        title="Save Filter"
        size="sm"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!saveFilterName.trim()) return;
            const query: Record<string, string> = {};
            for (const [k, v] of searchParams.entries()) query[k] = v;
            if (searchQuery.trim()) query.search = searchQuery.trim();
            if (typeFilter.length) query.type = typeFilter.join(',');
            if (priorityFilter.length) query.priority = priorityFilter.join(',');
            if (assigneeFilter.length) query.assignee = assigneeFilter.join(',');
            if (labelFilter.length) query.label = labelFilter.join(',');
            if (sortField !== 'createdAt') query.sort = sortField;
            if (sortDir !== 'desc') query.dir = sortDir;
            saveFilterMutation.mutate({
              name: saveFilterName.trim(),
              query,
              projectId: currentProject?.id,
            });
          }}
        >
          <Input
            label="Filter name"
            placeholder="e.g. My urgent bugs"
            value={saveFilterName}
            onChange={(e) => setSaveFilterName(e.target.value)}
            autoFocus
          />
          <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-border-light">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => setShowSaveFilterModal(false)}
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
            <Button
              size="sm"
              type="submit"
              disabled={!saveFilterName.trim() || saveFilterMutation.isPending}
            >
              <Bookmark className="h-3.5 w-3.5" /> Save
            </Button>
          </div>
        </form>
      </Modal>
    </PageLayout>
  );
}
