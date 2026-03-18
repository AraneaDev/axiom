import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Filter,
  ArrowUpDown,
  LayoutList,
  LayoutGrid,
  LayoutDashboard,
  ChevronDown,
  X,
  User,
  Search,
  GanttChart,
  Target,
  CheckSquare,
  Columns,
  AlertTriangle,
  Trash2,
  Bookmark,
  BookmarkCheck,
} from 'lucide-react';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { issuesApi } from '@/api/issues.api';
import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { savedFiltersApi } from '@/api/saved-filters.api';
import { sprintsApi } from '@/api/sprints.api';
import { teamsApi } from '@/api/teams.api';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { PageLoader } from '@/components/ui/Spinner';
import { PRIORITY_COLORS, PRIORITY_LABELS, ISSUE_TYPE_LABELS } from '@/lib/constants';
import { cn, formatRelative } from '@/lib/utils';

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
    mutationFn: (data: { name: string; query: Record<string, string>; projectId?: string }) =>
      savedFiltersApi.create(data),
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
    mutationFn: (data: {
      issueIds: string[];
      updates: {
        status?: string;
        assigneeId?: string | null;
        priority?: string;
        sprintId?: string | null;
      };
    }) => issuesApi.bulkUpdate(currentProject!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', currentProject?.id] });
      queryClient.invalidateQueries({ queryKey: ['board', currentProject?.id] });
      setSelectedIds(new Set());
      setBulkDropdown(null);
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      // Delete issues one by one using the existing delete endpoint
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

  const toggleFilter = (arr: string[], val: string, setter: (v: string[]) => void) => {
    setter(arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val]);
  };

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

  if (isLoading) return <PageLoader />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">{currentProject?.name} Issues</h1>
          <p className="text-sm text-text-secondary">
            {hasActiveSearch || activeFilterCount > 0
              ? `${filteredIssues.length} of ${data?.total ?? 0} issues`
              : `${data?.total ?? 0} issues`}
          </p>
        </div>
        <div className="flex gap-2">
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
          <Link to={`/${org}/${teamSlug}/${projectSlug}/issues/new`}>
            <Button size="sm">
              <Plus className="h-4 w-4" /> New Issue
            </Button>
          </Link>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4">
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
        <div className="rounded-lg border border-primary/30 bg-primary-light/10 p-2 mb-4 flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-text px-2">
            <CheckSquare className="h-4 w-4 inline mr-1" />
            {selectedIds.size} issue{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="h-4 w-px bg-border mx-1" />

          {/* Set Status */}
          <div className="relative">
            <Button
              variant="secondary"
              size="xs"
              onClick={() => setBulkDropdown(bulkDropdown === 'status' ? null : 'status')}
            >
              <Columns className="h-3 w-3" /> Set Status <ChevronDown className="h-3 w-3" />
            </Button>
            {bulkDropdown === 'status' && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setBulkDropdown(null)} />
                <div className="absolute left-0 top-full mt-1 w-44 rounded-lg border border-border bg-surface-elevated shadow-lg py-1 z-20">
                  {boardColumns.map((col) => (
                    <Button
                      key={col.id}
                      variant="ghost"
                      size="xs"
                      className="w-full justify-start rounded-none"
                      onClick={() =>
                        bulkMutation.mutate({
                          issueIds: Array.from(selectedIds),
                          updates: { status: col.id },
                        })
                      }
                    >
                      <Columns className="h-3 w-3" /> {col.name}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Assign */}
          <div className="relative">
            <Button
              variant="secondary"
              size="xs"
              onClick={() => setBulkDropdown(bulkDropdown === 'assign' ? null : 'assign')}
            >
              <User className="h-3 w-3" /> Assign <ChevronDown className="h-3 w-3" />
            </Button>
            {bulkDropdown === 'assign' && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setBulkDropdown(null)} />
                <div className="absolute left-0 top-full mt-1 w-48 rounded-lg border border-border bg-surface-elevated shadow-lg py-1 z-20 max-h-48 overflow-y-auto">
                  <Button
                    variant="ghost"
                    size="xs"
                    className="w-full justify-start rounded-none"
                    onClick={() =>
                      bulkMutation.mutate({
                        issueIds: Array.from(selectedIds),
                        updates: { assigneeId: null },
                      })
                    }
                  >
                    <User className="h-3 w-3" /> Unassigned
                  </Button>
                  {teamDetail?.members?.map((m: { user: { id: string; displayName: string } }) => (
                    <Button
                      key={m.user.id}
                      variant="ghost"
                      size="xs"
                      className="w-full justify-start rounded-none"
                      onClick={() =>
                        bulkMutation.mutate({
                          issueIds: Array.from(selectedIds),
                          updates: { assigneeId: m.user.id },
                        })
                      }
                    >
                      <Avatar name={m.user.displayName} size="sm" /> {m.user.displayName}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Set Priority */}
          <div className="relative">
            <Button
              variant="secondary"
              size="xs"
              onClick={() => setBulkDropdown(bulkDropdown === 'priority' ? null : 'priority')}
            >
              <AlertTriangle className="h-3 w-3" /> Priority <ChevronDown className="h-3 w-3" />
            </Button>
            {bulkDropdown === 'priority' && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setBulkDropdown(null)} />
                <div className="absolute left-0 top-full mt-1 w-40 rounded-lg border border-border bg-surface-elevated shadow-lg py-1 z-20">
                  {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                    <Button
                      key={key}
                      variant="ghost"
                      size="xs"
                      className="w-full justify-start rounded-none"
                      onClick={() =>
                        bulkMutation.mutate({
                          issueIds: Array.from(selectedIds),
                          updates: { priority: key },
                        })
                      }
                    >
                      <AlertTriangle className="h-3 w-3" /> {label}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Move to Sprint */}
          <div className="relative">
            <Button
              variant="secondary"
              size="xs"
              onClick={() => setBulkDropdown(bulkDropdown === 'sprint' ? null : 'sprint')}
            >
              <Target className="h-3 w-3" /> Sprint <ChevronDown className="h-3 w-3" />
            </Button>
            {bulkDropdown === 'sprint' && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setBulkDropdown(null)} />
                <div className="absolute left-0 top-full mt-1 w-48 rounded-lg border border-border bg-surface-elevated shadow-lg py-1 z-20 max-h-48 overflow-y-auto">
                  <Button
                    variant="ghost"
                    size="xs"
                    className="w-full justify-start rounded-none"
                    onClick={() =>
                      bulkMutation.mutate({
                        issueIds: Array.from(selectedIds),
                        updates: { sprintId: null },
                      })
                    }
                  >
                    <Target className="h-3 w-3" /> Backlog
                  </Button>
                  {sprints
                    .filter((s) => s.status !== 'COMPLETED')
                    .map((s) => (
                      <Button
                        key={s.id}
                        variant="ghost"
                        size="xs"
                        className="w-full justify-start rounded-none"
                        onClick={() =>
                          bulkMutation.mutate({
                            issueIds: Array.from(selectedIds),
                            updates: { sprintId: s.id },
                          })
                        }
                      >
                        <Target className="h-3 w-3" /> {s.name}
                      </Button>
                    ))}
                </div>
              </>
            )}
          </div>

          {/* Delete */}
          {showDeleteConfirm ? (
            <div className="flex items-center gap-1 ml-2">
              <span className="text-xs text-danger">
                Delete {selectedIds.size} issue{selectedIds.size !== 1 ? 's' : ''}?
              </span>
              <Button
                variant="danger"
                size="xs"
                onClick={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
                disabled={bulkDeleteMutation.isPending}
              >
                <Trash2 className="h-3 w-3" /> Confirm
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setShowDeleteConfirm(false)}>
                <X className="h-3 w-3" /> Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setShowDeleteConfirm(true)}
              className="text-danger hover:text-danger hover:bg-danger-light ml-2"
            >
              <Trash2 className="h-3 w-3" /> Delete
            </Button>
          )}

          <div className="ml-auto">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setSelectedIds(new Set());
                setBulkDropdown(null);
                setShowDeleteConfirm(false);
              }}
              className="text-text-tertiary"
            >
              <X className="h-3 w-3" /> Clear selection
            </Button>
          </div>
        </div>
      )}

      {/* Filter bar */}
      {showFilters && (
        <div className="rounded-lg border border-border bg-surface p-3 mb-4 flex flex-wrap gap-4">
          <div>
            <p className="text-xs font-semibold text-text-secondary mb-1.5">Type</p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(ISSUE_TYPE_LABELS).map(([key, label]) => (
                <Button
                  key={key}
                  variant="outline"
                  size="xs"
                  onClick={() => toggleFilter(typeFilter, key, setTypeFilter)}
                  className={cn(
                    typeFilter.includes(key)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-text-secondary hover:border-border-focus',
                  )}
                >
                  <IssueTypeIcon type={key} className="h-3 w-3" /> {label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-text-secondary mb-1.5">Priority</p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                <Button
                  key={key}
                  variant="outline"
                  size="xs"
                  onClick={() => toggleFilter(priorityFilter, key, setPriorityFilter)}
                  className={cn(
                    priorityFilter.includes(key)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-text-secondary hover:border-border-focus',
                  )}
                >
                  <Filter className="h-3 w-3" /> {label}
                </Button>
              ))}
            </div>
          </div>
          {allAssignees.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-1.5">Assignee</p>
              <div className="flex flex-wrap gap-1">
                {allAssignees.map((a) => (
                  <Button
                    key={a.id}
                    variant="outline"
                    size="xs"
                    onClick={() => toggleFilter(assigneeFilter, a.id, setAssigneeFilter)}
                    className={cn(
                      assigneeFilter.includes(a.id)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-text-secondary hover:border-border-focus',
                    )}
                  >
                    <User className="h-3 w-3" /> {a.displayName}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {allLabels.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-1.5">Label</p>
              <div className="flex flex-wrap gap-1">
                {allLabels.map((l) => (
                  <Button
                    key={l.id}
                    variant="outline"
                    size="xs"
                    onClick={() => toggleFilter(labelFilter, l.id, setLabelFilter)}
                    className={cn(
                      labelFilter.includes(l.id)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-text-secondary hover:border-border-focus',
                    )}
                  >
                    <Filter className="h-3 w-3" /> {l.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setTypeFilter([]);
                setPriorityFilter([]);
                setAssigneeFilter([]);
                setLabelFilter([]);
              }}
              className="text-text-tertiary hover:text-danger self-end"
            >
              <X className="h-3 w-3" /> Clear all
            </Button>
          )}
        </div>
      )}

      {!filteredIssues.length ? (
        <EmptyState
          title="No issues found"
          description={
            hasActiveSearch
              ? 'No issues match your search. Try a different query.'
              : activeFilterCount > 0
                ? 'Try adjusting your filters.'
                : 'Create your first issue to get started.'
          }
        />
      ) : viewMode === 'list' ? (
        <div className="rounded-lg border border-border bg-surface divide-y divide-border">
          {/* Select all header */}
          <div className="flex items-center gap-3 px-3 py-2 bg-surface-secondary/50">
            <input
              type="checkbox"
              checked={selectedIds.size === filteredIssues.length && filteredIssues.length > 0}
              onChange={toggleSelectAll}
              className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
              title="Select all"
            />
            <span className="text-xs text-text-tertiary">
              {hasSelection ? `${selectedIds.size} selected` : 'Select all'}
            </span>
          </div>
          {filteredIssues.map((issue) => (
            <div
              key={issue.id}
              className={cn(
                'flex items-center gap-3 p-3 hover:bg-surface-secondary transition-colors',
                selectedIds.has(issue.id) && 'bg-primary-light/5',
              )}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(issue.id)}
                onClick={(e) => toggleSelect(issue.id, e)}
                onChange={() => {}}
                className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer shrink-0"
              />
              <Link
                to={`/${org}/${teamSlug}/${projectSlug}/issues/${issue.number}`}
                className="flex items-center gap-3 flex-1 min-w-0"
              >
                <IssueTypeIcon type={issue.type} className="h-4 w-4" />
                <span className="text-xs text-text-secondary font-mono w-16">{issue.key}</span>
                <span className="flex-1 text-sm font-medium truncate">{issue.title}</span>
                {issue.labels?.map((l) => (
                  <Badge key={l.id} className="text-xs">
                    {l.name}
                  </Badge>
                ))}
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLORS[issue.priority]}`}
                >
                  {issue.priority}
                </span>
                {issue.column && (
                  <span className="text-xs text-text-secondary">{issue.column.name}</span>
                )}
                {issue.assignee && <Avatar name={issue.assignee.displayName} size="sm" />}
                <span className="text-xs text-text-secondary w-16 text-right">
                  {formatRelative(issue.updatedAt)}
                </span>
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {filteredIssues.map((issue) => (
            <div
              key={issue.id}
              className={cn(
                'relative rounded-lg border border-border bg-surface p-4 hover:shadow-sm hover:border-primary/30 transition-all',
                selectedIds.has(issue.id) && 'border-primary/50 bg-primary-light/5',
              )}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(issue.id)}
                onClick={(e) => toggleSelect(issue.id, e)}
                onChange={() => {}}
                className="absolute top-3 right-3 h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
              />
              <Link
                to={`/${org}/${teamSlug}/${projectSlug}/issues/${issue.number}`}
                className="block"
              >
                <div className="flex items-center gap-1.5 mb-2">
                  <IssueTypeIcon type={issue.type} className="h-4 w-4" />
                  <span className="text-xs text-text-secondary font-mono">{issue.key}</span>
                  <span
                    className={`ml-auto mr-6 text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLORS[issue.priority]}`}
                  >
                    {issue.priority}
                  </span>
                </div>
                <p className="text-sm font-medium line-clamp-2 mb-3">{issue.title}</p>
                <div className="flex items-center justify-between">
                  <div className="flex gap-1 flex-wrap">
                    {issue.labels?.slice(0, 2).map((l) => (
                      <Badge key={l.id} className="text-xs">
                        {l.name}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    {issue.column && (
                      <span className="text-xs text-text-tertiary">{issue.column.name}</span>
                    )}
                    {issue.assignee && <Avatar name={issue.assignee.displayName} size="sm" />}
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}

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
