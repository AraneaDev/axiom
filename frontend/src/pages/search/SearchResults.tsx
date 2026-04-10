import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Search,
  FileText,
  Code2,
  GitFork,
  BookOpen,
  Bookmark,
  BookmarkPlus,
  Trash2,
  Eye,
  Lock,
  Info,
  X,
  Filter,
  Tag,
  Calendar,
  Library,
} from 'lucide-react';
import { useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router';

import { searchApi } from '@/api/search.api';
import type { SearchType, SearchFilters } from '@/api/search.api';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { Tabs } from '@/components/ui/Tabs';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import type { SearchResult, SearchResultItem, SavedSearch } from '@/lib/types';

const SEARCH_TABS = [
  { key: 'all', label: 'All', icon: <Search className="h-4 w-4" /> },
  { key: 'issues', label: 'Issues', icon: <BookOpen className="h-4 w-4" /> },
  { key: 'code', label: 'Code', icon: <Code2 className="h-4 w-4" /> },
  { key: 'wiki', label: 'Wiki', icon: <FileText className="h-4 w-4" /> },
  { key: 'repos', label: 'Repositories', icon: <GitFork className="h-4 w-4" /> },
];

/**
 *
 */
export default function SearchResults() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const activeType = (searchParams.get('type') || 'all') as SearchType;
  const [inputValue, setInputValue] = useState(query);

  // Wiki filter state from URL params
  const spaceId = searchParams.get('spaceId') || '';
  const labelFilter = searchParams.get('label') || '';
  const sinceFilter = searchParams.get('since') || '';
  const untilFilter = searchParams.get('until') || '';
  const [labelInput, setLabelInput] = useState(labelFilter);

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
    setLabelInput('');
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
    <div className="px-6 py-4">
      {/* Search input */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Search className="h-5 w-5 text-text-secondary" />
          <Input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch(inputValue);
            }}
            placeholder="Search issues, code, wiki pages, repos..."
            className="flex-1 text-lg border-none outline-none bg-transparent placeholder:text-text-secondary text-text"
            autoFocus
          />
          <div className="flex items-center gap-2">
            {query && (
              <Button size="sm" variant="outline" onClick={handleSaveSearch}>
                <BookmarkPlus className="h-4 w-4" /> Save
              </Button>
            )}
            <Dropdown
              align="right"
              trigger={
                <Button size="sm" variant="ghost">
                  <Bookmark className="h-4 w-4" /> Saved
                </Button>
              }
            >
              {!savedSearches?.length ? (
                <p className="px-3 py-4 text-sm text-text-tertiary text-center">
                  No saved searches yet
                </p>
              ) : (
                savedSearches.map((s: SavedSearch) => (
                  <div key={s.id} className="flex items-center group">
                    <DropdownItem
                      onClick={() => loadSavedSearch(s)}
                      className="flex-1 justify-start"
                    >
                      <Bookmark className="h-3 w-3 text-text-tertiary" />
                      {s.name}
                    </DropdownItem>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="px-2 py-1 opacity-0 group-hover:opacity-100 text-danger hover:bg-danger-light transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSavedMutation.mutate(s.id);
                      }}
                      title="Delete saved search"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))
              )}
            </Dropdown>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
          <Info className="h-3 w-3" />
          <span>Use type:bug status:open priority:high assignee:name for advanced search</span>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={tabsWithCounts}
        activeKey={activeType}
        onChange={handleTabChange}
        className="mb-6"
      />

      {/* Wiki filters */}
      {(activeType === 'wiki' || activeType === 'all') && (
        <Card className="flex items-center gap-2 flex-wrap mb-4 p-3">
          <Filter className="h-4 w-4 text-text-tertiary shrink-0" />
          <span className="text-xs font-medium text-text-secondary mr-1">Wiki filters:</span>

          {/* Space dropdown */}
          <Dropdown
            align="left"
            trigger={
              <Button variant="outline" size="xs">
                <Library className="h-3.5 w-3.5" />
                {spaceId && allSpaces
                  ? allSpaces.find((s: { id: string }) => s.id === spaceId)?.name || 'Space'
                  : 'All spaces'}
              </Button>
            }
          >
            <DropdownItem onClick={() => setFilter('spaceId', '')}>
              <Library className="h-3.5 w-3.5" /> All spaces
            </DropdownItem>
            {allSpaces?.map((s: { id: string; name: string }) => (
              <DropdownItem key={s.id} onClick={() => setFilter('spaceId', s.id)}>
                <BookOpen className="h-3.5 w-3.5" /> {s.name}
              </DropdownItem>
            ))}
          </Dropdown>

          {/* Label filter */}
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              setFilter('label', labelInput.trim());
            }}
          >
            <Input
              type="text"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="Filter by label"
              className="h-7 w-32 text-xs"
            />
            {labelInput.trim() && (
              <Button type="submit" variant="outline" size="xs">
                <Tag className="h-3 w-3" /> Apply
              </Button>
            )}
          </form>

          {/* Since date */}
          <Input
            type="date"
            value={sinceFilter}
            onChange={(e) => setFilter('since', e.target.value)}
            className="h-7 w-36 text-xs"
            title="Updated since"
          />

          {/* Until date */}
          <Input
            type="date"
            value={untilFilter}
            onChange={(e) => setFilter('until', e.target.value)}
            className="h-7 w-36 text-xs"
            title="Updated until"
          />

          {/* Clear all filters */}
          {hasActiveFilters && (
            <Button variant="ghost" size="xs" onClick={clearAllFilters}>
              <X className="h-3 w-3" /> Clear filters
            </Button>
          )}

          {/* Active filter badges */}
          {spaceId && allSpaces && (
            <Badge size="sm" variant="default">
              <Library className="h-3 w-3" />
              {allSpaces.find((s: { id: string }) => s.id === spaceId)?.name}
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setFilter('spaceId', '')}
                className="ml-1 p-0 hover:text-danger"
                title="Remove space filter"
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          )}
          {labelFilter && (
            <Badge size="sm" variant="default">
              <Tag className="h-3 w-3" />
              {labelFilter}
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => {
                  setFilter('label', '');
                  setLabelInput('');
                }}
                className="ml-1 p-0 hover:text-danger"
                title="Remove label filter"
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          )}
          {sinceFilter && (
            <Badge size="sm" variant="default">
              <Calendar className="h-3 w-3" />
              from {sinceFilter}
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setFilter('since', '')}
                className="ml-1 p-0 hover:text-danger"
                title="Remove since filter"
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          )}
          {untilFilter && (
            <Badge size="sm" variant="default">
              <Calendar className="h-3 w-3" />
              until {untilFilter}
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setFilter('until', '')}
                className="ml-1 p-0 hover:text-danger"
                title="Remove until filter"
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          )}
        </Card>
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
              {group.type === 'code' &&
                group.items.map((item, idx) => {
                  const codeItem = item as unknown as CodeItem;
                  return (
                    <CodeRow
                      key={`${codeItem.repoId}-${codeItem.filePath}-${idx}`}
                      item={codeItem}
                      query={query}
                    />
                  );
                })}
              {group.type === 'wiki' &&
                group.items.map((item) => <WikiRow key={item.id} item={item} />)}
              {group.type === 'repos' &&
                group.items.map((item) => <RepoRow key={item.id} item={item} />)}
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

// ─── Row Component Types ─────────────────────────────────────

interface CodeItem extends SearchResultItem {
  repoId: string;
  repoName: string;
  repoUrl: string;
  filePath: string;
  lineNumber: number;
  lineContent: string;
}

// ─── Row Components ─────────────────────────────────────────

function IssueRow({ item }: { item: SearchResultItem }) {
  return (
    <Link
      to={item.url ?? '#'}
      className="flex items-center gap-3 p-3 hover:bg-surface-secondary transition-colors"
    >
      <IssueTypeIcon type={item.type ?? ''} className="h-3.5 w-3.5" />
      <span className="text-xs font-mono text-text-secondary">{item.key}</span>
      <span className="text-sm font-medium flex-1 truncate">{item.title}</span>
      <Badge size="sm">{item.status}</Badge>
      <span className="text-xs text-text-tertiary">{item.projectName}</span>
      {item.assignee && (
        <Avatar name={item.assignee.displayName} src={item.assignee.avatarUrl} size="xs" />
      )}
      <Badge
        size="sm"
        variant={
          item.priority === 'CRITICAL'
            ? 'danger'
            : item.priority === 'HIGH'
              ? 'warning'
              : item.priority === 'LOW'
                ? 'success'
                : 'default'
        }
      >
        {item.priority}
      </Badge>
    </Link>
  );
}

function CodeRow({ item, query }: { item: CodeItem; query: string }) {
  const highlighted = highlightMatch(item.lineContent, query);

  return (
    <div className="p-3 hover:bg-surface-secondary transition-colors">
      <div className="flex items-center gap-2 mb-1.5">
        <Code2 className="h-3.5 w-3.5 text-text-tertiary" />
        <Link to={item.repoUrl} className="text-xs font-medium text-primary hover:underline">
          {item.repoName}
        </Link>
        <span className="text-text-tertiary text-xs">/</span>
        <Link
          to={`${item.repoUrl}/blob/HEAD/${item.filePath}`}
          className="text-xs text-text-secondary hover:text-primary hover:underline truncate"
        >
          {item.filePath}
        </Link>
      </div>
      <div className="rounded bg-surface-tertiary border border-border-light px-3 py-1.5 font-mono text-xs overflow-x-auto">
        <span className="text-text-tertiary select-none mr-3">{item.lineNumber}</span>
        {/* eslint-disable-next-line react/no-danger -- search highlight markup is escaped server-side */}
        <span dangerouslySetInnerHTML={{ __html: highlighted }} />
      </div>
    </div>
  );
}

function WikiRow({ item }: { item: SearchResultItem }) {
  return (
    <Link to={item.url ?? '#'} className="block p-3 hover:bg-surface-secondary transition-colors">
      <div className="flex items-center gap-3 mb-1">
        <FileText className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-medium flex-1">{item.title}</span>
        <Badge size="sm">{item.spaceName || item.slug}</Badge>
      </div>
      {item.snippet && (
        <p
          className="text-xs text-text-tertiary ml-7 line-clamp-2"
          // eslint-disable-next-line react/no-danger -- snippet is escaped server-side
          dangerouslySetInnerHTML={{ __html: formatSnippet(item.snippet) }}
        />
      )}
    </Link>
  );
}

function RepoRow({ item }: { item: SearchResultItem }) {
  const isPublic = item.visibility === 'PUBLIC';

  return (
    <Link
      to={item.url ?? '#'}
      className="flex items-center gap-3 p-3 hover:bg-surface-secondary transition-colors"
    >
      <GitFork className="h-4 w-4 text-text-secondary" />
      <span className="text-sm font-medium">{item.name}</span>
      <span className="text-xs text-text-tertiary flex-1 truncate">
        {item.description || 'No description'}
      </span>
      <Badge size="sm" variant={isPublic ? 'success' : 'outline'}>
        {isPublic ? <Eye className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
        {item.visibility?.toLowerCase()}
      </Badge>
    </Link>
  );
}

// ─── Helpers ────────────────────────────────────────────────

function highlightMatch(text: string, query: string): string {
  if (!query) return escapeHtml(text);
  // Extract just the free text part (remove structured filters)
  const freeText = query
    .split(/\s+/)
    .filter((t) => !t.includes(':'))
    .join(' ')
    .trim();
  if (!freeText) return escapeHtml(text);

  const escaped = freeText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  return escapeHtml(text).replace(
    regex,
    '<mark class="bg-warning-light text-warning rounded px-0.5">$1</mark>',
  );
}

function formatSnippet(snippet: string): string {
  // Convert << >> markers from ts_headline to <mark> tags
  return escapeHtml(snippet)
    .replace(/&lt;&lt;/g, '<mark class="bg-warning-light text-warning rounded px-0.5">')
    .replace(/&gt;&gt;/g, '</mark>');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
