import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Search, FileText, BookOpen, X } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router';

import type { SearchType, SearchFilters } from '@/api/search.api';
import { searchApi } from '@/api/search.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { Tabs } from '@/components/ui/Tabs';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import type { SearchResult, SavedSearch } from '@/lib/types';

import { SearchBar } from './SearchBar';
import { IssueRow, WikiRow } from './SearchResultRows';
import { WikiFilters } from './WikiFilters';

const SEARCH_TABS = [
  { key: 'all', label: 'All', icon: <Search className="h-4 w-4" /> },
  { key: 'issues', label: 'Issues', icon: <BookOpen className="h-4 w-4" /> },
  { key: 'wiki', label: 'Wiki', icon: <FileText className="h-4 w-4" /> },
];

const SEARCH_TYPES: readonly SearchType[] = ['all', 'issues', 'wiki'];

/**
 * Unknown `?type=` values (e.g. `code`, `repos` from old links or saved filters) fall back to all.
 * @param value raw `type` search param
 */
function toSearchType(value: string | null): SearchType {
  return SEARCH_TYPES.includes(value as SearchType) ? (value as SearchType) : 'all';
}

/**
 *
 */
export default function SearchResults() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const activeType = toSearchType(searchParams.get('type'));
  const [inputValue, setInputValue] = useState(query);

  // Wiki filter state from URL params
  const spaceId = searchParams.get('spaceId') || '';
  const labelFilter = searchParams.get('label') || '';
  const sinceFilter = searchParams.get('since') || '';
  const untilFilter = searchParams.get('until') || '';

  const filters: SearchFilters = useMemo(() => {
    const f: SearchFilters = {};
    if (spaceId) f.spaceId = spaceId;
    if (labelFilter) f.label = labelFilter;
    if (sinceFilter) f.since = sinceFilter;
    if (untilFilter) f.until = untilFilter;
    return f;
  }, [spaceId, labelFilter, sinceFilter, untilFilter]);

  const hasActiveFilters = !!(spaceId || labelFilter || sinceFilter || untilFilter);

  const {
    data: results,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['search', query, activeType, filters],
    queryFn: () => searchApi.search(query, activeType, filters),
    enabled: query.length > 0,
  });

  // Fetch spaces for the filter dropdown (only when showing wiki)
  const { data: allSpaces } = useQuery({
    queryKey: ['searchAccessibleSpaces'],
    queryFn: () => searchApi.getAccessibleSpaces(),
    enabled: activeType === 'wiki' || activeType === 'all',
  });

  const { data: savedSearches } = useQuery({
    queryKey: ['saved-searches'],
    queryFn: () => searchApi.getSavedSearches(),
  });

  const saveMutation = useMutationWithToast(
    (name: string) => searchApi.createSavedSearch(name, { q: query, type: activeType }),
    { successMessage: 'Search saved', invalidateKeys: [['saved-searches']] },
  );

  const deleteSavedMutation = useMutationWithToast(
    (id: string) => searchApi.deleteSavedSearch(id),
    { successMessage: null, invalidateKeys: [['saved-searches']] },
  );

  // Count results per type for tab labels
  const tabsWithCounts = useMemo(() => {
    if (!results) return SEARCH_TABS;
    return SEARCH_TABS.map((tab) => {
      if (tab.key === 'all') {
        const total = results.reduce(
          (sum: number, r: SearchResult) => sum + (r.total || r.items.length),
          0,
        );
        return { ...tab, label: `All (${total})` };
      }
      const group = results.find((r: SearchResult) => r.type === tab.key);
      const count = group ? group.total || group.items.length : 0;
      return { ...tab, label: `${tab.label} (${count})` };
    });
  }, [results]);

  function buildParams(overrides: Record<string, string> = {}) {
    const p: Record<string, string> = { q: query, type: activeType };
    if (spaceId) p.spaceId = spaceId;
    if (labelFilter) p.label = labelFilter;
    if (sinceFilter) p.since = sinceFilter;
    if (untilFilter) p.until = untilFilter;
    return { ...p, ...overrides };
  }

  function handleSearch(q: string) {
    if (q.trim()) {
      setSearchParams(buildParams({ q: q.trim() }));
    }
  }

  function handleTabChange(key: string) {
    // Clear wiki-specific filters when switching away from wiki
    if (key !== 'wiki' && key !== 'all') {
      setSearchParams({ q: query, type: key });
    } else {
      setSearchParams(buildParams({ type: key }));
    }
  }

  function setFilter(key: string, value: string) {
    const p = buildParams();
    if (value) {
      p[key] = value;
    } else {
      delete p[key];
    }
    setSearchParams(p);
  }

  function clearAllFilters() {
    setSearchParams({ q: query, type: activeType });
  }

  function handleSaveSearch() {
    if (!query) return;
    const name = window.prompt('Name this saved search:');
    if (name) {
      saveMutation.mutate(name);
    }
  }

  function loadSavedSearch(saved: SavedSearch) {
    setInputValue(saved.query.q);
    setSearchParams({ q: saved.query.q, type: saved.query.type || 'all' });
  }

  // Filter results to the active tab
  const displayResults = useMemo(() => {
    if (!results) return [];
    if (activeType === 'all') return results;
    return results.filter((r: SearchResult) => r.type === activeType);
  }, [results, activeType]);

  return (
    <div className="">
      {/* Search input */}
      <SearchBar
        inputValue={inputValue}
        onInputChange={setInputValue}
        onSearch={handleSearch}
        query={query}
        onSaveSearch={handleSaveSearch}
        savedSearches={savedSearches}
        onLoadSavedSearch={loadSavedSearch}
        onDeleteSavedSearch={(id) => deleteSavedMutation.mutate(id)}
      />

      {/* Tabs */}
      <Tabs
        tabs={tabsWithCounts}
        activeKey={activeType}
        onChange={handleTabChange}
        className="mb-6"
      />

      {/* Wiki filters */}
      {(activeType === 'wiki' || activeType === 'all') && (
        <WikiFilters
          spaceId={spaceId}
          labelFilter={labelFilter}
          sinceFilter={sinceFilter}
          untilFilter={untilFilter}
          allSpaces={allSpaces}
          onSetFilter={setFilter}
          onClearAllFilters={clearAllFilters}
          hasActiveFilters={hasActiveFilters}
        />
      )}

      {error && (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
            <p className="text-secondary">Failed to load search results</p>
          </div>
        </div>
      )}

      {isLoading && <ListSkeleton rows={6} />}

      {/* Results */}
      {displayResults.map((group: SearchResult) => (
        <div key={group.type} className="mb-8">
          {activeType === 'all' && (
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
              {group.type} ({group.total || group.items.length})
            </h2>
          )}

          {!group.items.length ? (
            activeType !== 'all' && (
              <EmptyState
                icon={<Search className="h-8 w-8" />}
                title={`No ${group.type} found`}
                description={`No matching ${group.type} for "${query}"`}
              />
            )
          ) : (
            <Card className="divide-y divide-border">
              {group.type === 'issues' &&
                group.items.map((item) => <IssueRow key={item.id} item={item} />)}
              {group.type === 'wiki' &&
                group.items.map((item) => <WikiRow key={item.id} item={item} />)}
            </Card>
          )}
        </div>
      ))}

      {query && !isLoading && (!results || results.every((r: SearchResult) => !r.items.length)) && (
        <EmptyState
          icon={<Search className="h-10 w-10" />}
          title="No results"
          description={`Nothing found for "${query}"`}
          action={
            <Button
              variant="outline"
              onClick={() => {
                setInputValue('');
                setSearchParams({});
              }}
            >
              <X className="h-4 w-4" /> Clear search
            </Button>
          }
        />
      )}
    </div>
  );
}
