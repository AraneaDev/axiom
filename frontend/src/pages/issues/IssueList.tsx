import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Filter,
  ArrowUpDown,
  LayoutList,
  LayoutGrid,
  LayoutDashboard,
  LayoutTemplate,
  ChevronDown,
  X,
  Search,
  GanttChart,
  Target,
  Bookmark,
  BookmarkCheck,
  Zap,
  Tag,
  BarChart3,
} from 'lucide-react';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { IssueListBulkActions } from './IssueListBulkActions';
import { IssueListFilters } from './IssueListFilters';
import { IssueListTable } from './IssueListTable';

import { issuesApi } from '@/api/issues.api';
import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { savedFiltersApi } from '@/api/saved-filters.api';
import { sprintsApi } from '@/api/sprints.api';
import { teamsApi } from '@/api/teams.api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { STABLE_STALE_TIME } from '@/lib/constants';
import { cn } from '@/lib/utils';

type SortField = 'createdAt' | 'updatedAt' | 'priority';
type SortDir = 'asc' | 'desc';
type ViewMode = 'list' | 'grid';

const PRIORITY_ORDER: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 };

/**
 *
 */
export default function IssueList() {
  const { org, team: teamSlug, project: projectSlug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

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

  // Pagination state from URL
  const pageLimit = parseInt(searchParams.get('limit') || '25');
  const pageOffset = parseInt(searchParams.get('offset') || '0');

  const filters: Record<string, string> = {};
  for (const [k, v] of searchParams.entries()) filters[k] = v;

  const { data, isLoading } = useQuery({
    queryKey: ['issues', currentProject?.id, filters],
    queryFn: () => issuesApi.list(currentProject!.id, filters),
    enabled: !!currentProject?.id,
  });

  // Board columns for bulk status change
  const { data: boardColumns = [] } = useQuery({
    queryKey: ['board', currentProject?.id],
    queryFn: () => issuesApi.getBoard(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  // Team members for bulk assign
  const { data: teamDetail } = useQuery({
    queryKey: ['team-detail', currentTeam?.id],
    queryFn: () => teamsApi.get(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });

  // Sprints for bulk sprint move
  const { data: sprints = [] } = useQuery({
    queryKey: ['sprints', currentProject?.id],
    queryFn: () => sprintsApi.list(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  // Filter state
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Sort state
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showSort, setShowSort] = useState(false);

  // View mode with localStorage
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      return (localStorage.getItem('issueListView') as ViewMode) || 'list';
    } catch {
      return 'list';
    }
  });
  useEffect(() => {
    localStorage.setItem('issueListView', viewMode);
  }, [viewMode]);

  // Search state with debounce
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchQuery(value), 250);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Saved filters
  const [showSaveFilterModal, setShowSaveFilterModal] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState('');
  const [showSavedFilters, setShowSavedFilters] = useState(false);

  const { data: savedFilters = [] } = useQuery({
    queryKey: ['saved-filters', currentProject?.id],
    queryFn: () => savedFiltersApi.list(currentProject?.id),
    enabled: !!currentProject?.id,
  });

  const saveFilterMutation = useMutation({
    mutationFn: (d: { name: string; query: Record<string, string>; projectId?: string }) =>
      savedFiltersApi.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-filters', currentProject?.id] });
      setShowSaveFilterModal(false);
      setSaveFilterName('');
    },
  });

  const deleteFilterMutation = useMutation({
    mutationFn: (filterId: string) => savedFiltersApi.delete(filterId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-filters', currentProject?.id] });
    },
  });

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDropdown, setBulkDropdown] = useState<string | null>(null);
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

  const bulkMutation = useMutation({
    mutationFn: (d: {
      issueIds: string[];
      updates: {
        status?: string;
        assigneeId?: string | null;
        priority?: string;
        sprintId?: string | null;
      };
    }) => issuesApi.bulkUpdate(currentProject!.id, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', currentProject?.id] });
      queryClient.invalidateQueries({ queryKey: ['board', currentProject?.id] });
      setSelectedIds(new Set());
      setBulkDropdown(null);
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const issuesData = data?.issues ?? [];
      for (const id of ids) {
        const issue = issuesData.find((i) => i.id === id);
        if (issue) {
          await issuesApi.delete(currentProject!.id, issue.number);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', currentProject?.id] });
      queryClient.invalidateQueries({ queryKey: ['board', currentProject?.id] });
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
    },
  });

  // Extract unique assignees and labels for filter options
  const allAssignees = useMemo(() => {
    const map = new Map<string, { id: string; displayName: string }>();
    for (const issue of data?.issues ?? []) {
      if (issue.assignee) map.set(issue.assignee.id, issue.assignee);
    }
    return Array.from(map.values());
  }, [data?.issues]);

  const allLabels = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const issue of data?.issues ?? []) {
      for (const label of issue.labels ?? []) map.set(label.id, label);
    }
    return Array.from(map.values());
  }, [data?.issues]);

  // Filtered and sorted issues
  let filteredIssues = data?.issues ?? [];
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    filteredIssues = filteredIssues.filter(
      (i) => i.title.toLowerCase().includes(q) || i.key.toLowerCase().includes(q),
    );
  }
  if (typeFilter.length > 0)
    filteredIssues = filteredIssues.filter((i) => typeFilter.includes(i.type));
  if (priorityFilter.length > 0)
    filteredIssues = filteredIssues.filter((i) => priorityFilter.includes(i.priority));
  if (assigneeFilter.length > 0)
    filteredIssues = filteredIssues.filter(
      (i) => i.assignee && assigneeFilter.includes(i.assignee.id),
    );
  if (labelFilter.length > 0)
    filteredIssues = filteredIssues.filter((i) =>
      i.labels?.some((l) => labelFilter.includes(l.id)),
    );
  filteredIssues = [...filteredIssues].sort((a, b) => {
    const cmp =
      sortField === 'priority'
        ? (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4)
        : new Date(a[sortField]).getTime() - new Date(b[sortField]).getTime();
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const activeFilterCount =
    typeFilter.length + priorityFilter.length + assigneeFilter.length + labelFilter.length;
  const hasActiveSearch = searchQuery.trim().length > 0;
  const hasSelection = selectedIds.size > 0;

  if (isLoading)
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Issues</h1>
        </div>
        <ListSkeleton rows={8} />
      </div>
    );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{currentProject?.name} Issues</h1>
          <span className="inline-flex items-center rounded-full bg-surface-tertiary px-2.5 py-0.5 text-xs font-medium text-text-secondary">
            {hasActiveSearch || activeFilterCount > 0
              ? `${filteredIssues.length} / ${data?.total ?? 0}`
              : `${data?.total ?? 0}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/${org}/${teamSlug}/${projectSlug}/backlog`}>
            <Button variant="secondary" size="sm">
              <Target className="h-4 w-4" /> Backlog
            </Button>
          </Link>
          <Link to={`/${org}/${teamSlug}/${projectSlug}/board`}>
            <Button variant="secondary" size="sm">
              <LayoutDashboard className="h-4 w-4" /> Board
            </Button>
          </Link>
          <Link to={`/${org}/${teamSlug}/${projectSlug}/roadmap`}>
            <Button variant="secondary" size="sm">
              <GanttChart className="h-4 w-4" /> Roadmap
            </Button>
          </Link>
          <Link to={`/${org}/${teamSlug}/${projectSlug}/analytics`}>
            <Button variant="secondary" size="sm">
              <BarChart3 className="h-4 w-4" /> Analytics
            </Button>
          </Link>
          <Link to={`/${org}/${teamSlug}/${projectSlug}/settings/templates`}>
            <Button variant="secondary" size="sm">
              <LayoutTemplate className="h-4 w-4" /> Templates
            </Button>
          </Link>
          <Link to={`/${org}/${teamSlug}/${projectSlug}/settings/automation`}>
            <Button variant="secondary" size="sm">
              <Zap className="h-4 w-4" /> Automations
            </Button>
          </Link>
          <Link to={`/${org}/${teamSlug}/${projectSlug}/settings/labels`}>
            <Button variant="secondary" size="sm">
              <Tag className="h-4 w-4" /> Labels
            </Button>
          </Link>
          <Link to={`/${org}/${teamSlug}/${projectSlug}/issues/new`}>
            <Button size="sm">
              <Plus className="h-4 w-4" /> New Issue
            </Button>
          </Link>
        </div>
      </div>

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
            <button
              onClick={() => {
                setSearchInput('');
                setSearchQuery('');
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text"
              title="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <Button variant="secondary" size="sm" onClick={() => setShowFilters(!showFilters)}>
          <Filter className="h-3.5 w-3.5" /> Filters
          {activeFilterCount > 0 && (
            <span className="ml-1 bg-primary text-white text-[10px] rounded-full px-1.5 py-0.5">
              {activeFilterCount}
            </span>
          )}
        </Button>

        {/* Sort dropdown */}
        <div className="relative">
          <Button variant="secondary" size="sm" onClick={() => setShowSort(!showSort)}>
            <ArrowUpDown className="h-3.5 w-3.5" /> Sort
            <ChevronDown className="h-3 w-3" />
          </Button>
          {showSort && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowSort(false)} />
              <div className="absolute left-0 top-full mt-1 w-48 rounded-lg border border-border bg-surface-elevated shadow-lg py-1 z-20">
                {(
                  [
                    ['createdAt', 'Created'],
                    ['updatedAt', 'Updated'],
                    ['priority', 'Priority'],
                  ] as const
                ).map(([field, label]) => (
                  <Button
                    key={field}
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
                      else {
                        setSortField(field);
                        setSortDir('desc');
                      }
                      setShowSort(false);
                    }}
                    className={cn(
                      'w-full justify-between rounded-none',
                      sortField === field && 'text-primary font-medium',
                    )}
                  >
                    <ArrowUpDown className="h-3 w-3" /> {label}
                    {sortField === field && (
                      <span className="text-xs">{sortDir === 'asc' ? 'Asc' : 'Desc'}</span>
                    )}
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Saved filters dropdown */}
        <div className="relative">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowSavedFilters(!showSavedFilters)}
          >
            <BookmarkCheck className="h-3.5 w-3.5" /> Saved
            {savedFilters.length > 0 && (
              <span className="ml-1 bg-surface-tertiary text-text-secondary text-[10px] rounded-full px-1.5 py-0.5">
                {savedFilters.length}
              </span>
            )}
          </Button>
          {showSavedFilters && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowSavedFilters(false)} />
              <div className="absolute left-0 top-full mt-1 w-56 rounded-lg border border-border bg-surface-elevated shadow-lg py-1 z-20 max-h-64 overflow-y-auto">
                {savedFilters.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-text-tertiary">No saved filters</p>
                ) : (
                  savedFilters.map((sf) => (
                    <div key={sf.id} className="flex items-center group">
                      <button
                        className="flex-1 text-left px-3 py-2 text-sm hover:bg-surface-secondary transition-colors flex items-center gap-2"
                        onClick={() => {
                          const params = new URLSearchParams(sf.query as Record<string, string>);
                          setSearchParams(params);
                          setShowSavedFilters(false);
                        }}
                      >
                        <Bookmark className="h-3 w-3 text-primary shrink-0" />
                        <span className="truncate">{sf.name}</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteFilterMutation.mutate(sf.id);
                        }}
                        className="px-2 py-1 text-text-tertiary hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete saved filter"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

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
          bulkDropdown={bulkDropdown}
          setBulkDropdown={setBulkDropdown}
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
          allAssignees={allAssignees}
          allLabels={allLabels}
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
    </div>
  );
}
