import { useState, useMemo, useEffect, useRef, useCallback } from 'react';

import type { Issue } from '@/lib/types';

type SortField = 'createdAt' | 'updatedAt' | 'priority';
type SortDir = 'asc' | 'desc';
type ViewMode = 'list' | 'grid';

export interface FilterState {
  type: string[];
  priority: string[];
  assignee: string[];
  label: string[];
  sprint: string;
  column: string;
}

const INITIAL_FILTERS: FilterState = {
  type: [],
  priority: [],
  assignee: [],
  label: [],
  sprint: '',
  column: '',
};

const PRIORITY_ORDER: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 };

/**
 *
 * @param issues
 */
export function useIssueListFilters(issues: Issue[]) {
  // Filter state
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  const setFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(INITIAL_FILTERS);
  }, []);

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

  // Extract unique assignees and labels for filter options
  const allAssignees = useMemo(() => {
    const map = new Map<string, { id: string; displayName: string }>();
    for (const issue of issues) {
      if (issue.assignee) map.set(issue.assignee.id, issue.assignee);
    }
    return Array.from(map.values());
  }, [issues]);

  const allLabels = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const issue of issues) {
      for (const label of issue.labels ?? []) map.set(label.id, label);
    }
    return Array.from(map.values());
  }, [issues]);

  // Filtered and sorted issues
  const filteredIssues = useMemo(() => {
    let result = issues;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (i) => i.title.toLowerCase().includes(q) || i.key.toLowerCase().includes(q),
      );
    }
    if (filters.type.length > 0) result = result.filter((i) => filters.type.includes(i.type));
    if (filters.priority.length > 0)
      result = result.filter((i) => filters.priority.includes(i.priority));
    if (filters.assignee.length > 0)
      result = result.filter((i) => i.assignee && filters.assignee.includes(i.assignee.id));
    if (filters.label.length > 0)
      result = result.filter((i) => i.labels?.some((l) => filters.label.includes(l.id)));
    if (filters.sprint === 'none') {
      result = result.filter((i) => !i.sprintId);
    } else if (filters.sprint) {
      result = result.filter((i) => i.sprintId === filters.sprint);
    }
    if (filters.column) {
      result = result.filter((i) => i.column?.id === filters.column);
    }
    return [...result].sort((a, b) => {
      const cmp =
        sortField === 'priority'
          ? (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4)
          : new Date((a as unknown as Record<string, string>)[sortField]).getTime() -
            new Date((b as unknown as Record<string, string>)[sortField]).getTime();
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [issues, searchQuery, filters, sortField, sortDir]);

  const activeFilterCount =
    filters.type.length +
    filters.priority.length +
    filters.assignee.length +
    filters.label.length +
    (filters.sprint ? 1 : 0) +
    (filters.column ? 1 : 0);
  const hasActiveSearch = searchQuery.trim().length > 0;

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortField(field);
      setSortDir('desc');
    }
    setShowSort(false);
  };

  const clearSearch = () => {
    setSearchInput('');
    setSearchQuery('');
  };

  return {
    // Filter state
    filters,
    setFilter,
    clearFilters,
    showFilters,
    setShowFilters,
    // Sort state
    sortField,
    sortDir,
    showSort,
    setShowSort,
    toggleSort,
    // View mode
    viewMode,
    setViewMode,
    // Search
    searchInput,
    searchQuery,
    handleSearchChange,
    clearSearch,
    hasActiveSearch,
    // Computed
    filteredIssues,
    activeFilterCount,
    allAssignees,
    allLabels,
  };
}
