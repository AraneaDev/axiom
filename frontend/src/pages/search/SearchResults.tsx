import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
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
  ChevronDown,
  Info,
} from 'lucide-react';
import { useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router';

import { searchApi } from '@/api/search.api';
import type { SearchType } from '@/api/search.api';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { PageLoader } from '@/components/ui/Spinner';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { PRIORITY_COLORS } from '@/lib/constants';
import type { SearchResult, SavedSearch } from '@/lib/types';

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
  const [savedDropdownOpen, setSavedDropdownOpen] = useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: results, isLoading } = useQuery({
    queryKey: ['search', query, activeType],
    queryFn: () => searchApi.search(query, activeType),
    enabled: query.length > 0,
  });

  const { data: savedSearches } = useQuery({
    queryKey: ['saved-searches'],
    queryFn: () => searchApi.getSavedSearches(),
  });

  const saveMutation = useMutation({
    mutationFn: (name: string) => searchApi.createSavedSearch(name, { q: query, type: activeType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-searches'] });
      toast.success('Search saved');
    },
  });

  const deleteSavedMutation = useMutation({
    mutationFn: (id: string) => searchApi.deleteSavedSearch(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-searches'] });
    },
  });

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

  function handleSearch(q: string) {
    if (q.trim()) {
      setSearchParams({ q: q.trim(), type: activeType });
    }
  }

  function handleTabChange(key: string) {
    setSearchParams({ q: query, type: key });
  }

  function handleSaveSearch() {
    if (!query) return;
    const name = window.prompt('Name this saved search:');
    if (name) {
      saveMutation.mutate(name);
    }
  }

  function loadSavedSearch(saved: SavedSearch) {
    setSavedDropdownOpen(false);
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
    <div className="max-w-4xl mx-auto">
      {/* Search input */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Search className="h-5 w-5 text-text-secondary" />
          <input
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
            <div className="relative">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSavedDropdownOpen(!savedDropdownOpen)}
              >
                <Bookmark className="h-4 w-4" /> Saved
                <ChevronDown className="h-3 w-3" />
              </Button>
              {savedDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setSavedDropdownOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-border bg-surface-elevated shadow-lg py-1 z-50">
                    {!savedSearches?.length ? (
                      <p className="px-3 py-4 text-sm text-text-tertiary text-center">
                        No saved searches yet
                      </p>
                    ) : (
                      savedSearches.map((s: SavedSearch) => (
                        <div
                          key={s.id}
                          className="flex items-center gap-2 px-3 py-2 hover:bg-surface-secondary transition-colors group"
                        >
                          <button
                            className="flex-1 text-left text-sm text-text truncate"
                            onClick={() => loadSavedSearch(s)}
                          >
                            <Bookmark className="h-3 w-3 inline mr-1.5 text-text-tertiary" />
                            {s.name}
                          </button>
                          <button
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-danger-light transition-all"
                            onClick={() => deleteSavedMutation.mutate(s.id)}
                            title="Delete saved search"
                          >
                            <Trash2 className="h-3 w-3 text-danger" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
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

      {isLoading && <PageLoader />}

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
            <div className="rounded-lg border border-border bg-surface divide-y divide-border">
              {/* eslint-disable @typescript-eslint/no-explicit-any */}
              {group.type === 'issues' &&
                group.items.map((item: any) => <IssueRow key={item.id} item={item} />)}
              {group.type === 'code' &&
                group.items.map((item: any, idx: number) => (
                  <CodeRow
                    key={`${item.repoId}-${item.filePath}-${idx}`}
                    item={item}
                    query={query}
                  />
                ))}
              {group.type === 'wiki' &&
                group.items.map((item: any) => <WikiRow key={item.id} item={item} />)}
              {group.type === 'repos' &&
                group.items.map((item: any) => <RepoRow key={item.id} item={item} />)}
              {/* eslint-enable @typescript-eslint/no-explicit-any */}
            </div>
          )}
        </div>
      ))}

      {query && !isLoading && (!results || results.every((r: SearchResult) => !r.items.length)) && (
        <EmptyState
          icon={<Search className="h-10 w-10" />}
          title="No results"
          description={`Nothing found for "${query}"`}
        />
      )}
    </div>
  );
}

// ─── Row Components ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function IssueRow({ item }: { item: any }) {
  return (
    <Link
      to={item.url ?? '#'}
      className="flex items-center gap-3 p-3 hover:bg-surface-secondary transition-colors"
    >
      <IssueTypeIcon type={item.type} className="h-3.5 w-3.5" />
      <span className="text-xs font-mono text-text-secondary">{item.key}</span>
      <span className="text-sm font-medium flex-1 truncate">{item.title}</span>
      <Badge size="sm">{item.status}</Badge>
      <span className="text-xs text-text-tertiary">{item.projectName}</span>
      {item.assignee && (
        <Avatar name={item.assignee.displayName} src={item.assignee.avatarUrl} size="xs" />
      )}
      <span
        className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLORS[item.priority as keyof typeof PRIORITY_COLORS] ?? ''}`}
      >
        {item.priority}
      </span>
    </Link>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CodeRow({ item, query }: { item: any; query: string }) {
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
        <span dangerouslySetInnerHTML={{ __html: highlighted }} />
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function WikiRow({ item }: { item: any }) {
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
          dangerouslySetInnerHTML={{ __html: formatSnippet(item.snippet) }}
        />
      )}
    </Link>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function RepoRow({ item }: { item: any }) {
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
