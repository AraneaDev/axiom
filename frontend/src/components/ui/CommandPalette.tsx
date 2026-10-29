import { useQuery } from '@tanstack/react-query';
import { Search, FileText, BookOpen, ArrowRight, Info } from 'lucide-react';
import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';

import { searchApi } from '@/api/search.api';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui.store';

interface FlatItem {
  id: string;
  type: 'issues' | 'wiki';
  title: string;
  url: string;
}

/**
 *
 */
export function CommandPalette() {
  const { searchOpen, toggleSearch } = useUIStore();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  /* ---- debounce ---- */
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  /* ---- search query ---- */
  const { data: results, isLoading: searchLoading } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => searchApi.search(debouncedQuery),
    enabled: debouncedQuery.length > 1,
    staleTime: 30_000,
  });

  /* ---- flatten results into navigable list ---- */
  const flatItems = useMemo<FlatItem[]>(() => {
    if (!results) return [];
    return results.flatMap((group) =>
      group.items.map((item) => ({
        id: item.id,
        type: group.type as FlatItem['type'],
        title: item.title ?? item.name ?? '',
        url: item.url,
      })),
    );
  }, [results]);

  /* eslint-disable react-hooks/set-state-in-effect -- reset state on open/results change */
  /* ---- reset active index when results change ---- */
  useEffect(() => setActiveIndex(0), [flatItems]);

  /* ---- focus input when opened ---- */
  useEffect(() => {
    if (searchOpen) {
      setQuery('');
      setDebouncedQuery('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [searchOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* ---- global shortcut (Cmd/Ctrl + K) ---- */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleSearch();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleSearch]);

  /* ---- prevent body scroll ---- */
  useEffect(() => {
    if (searchOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [searchOpen]);

  /* ---- select handler ---- */
  const selectItem = (item: FlatItem) => {
    toggleSearch();
    navigate(item.url);
  };

  /* ---- keyboard navigation ---- */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      toggleSearch();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % Math.max(flatItems.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + flatItems.length) % Math.max(flatItems.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatItems[activeIndex]) {
        selectItem(flatItems[activeIndex]);
      } else if (query.trim()) {
        toggleSearch();
        navigate(`/search?q=${encodeURIComponent(query.trim())}`);
      }
    }
  };

  /* ---- group items for display ---- */
  if (!searchOpen) return null;

  const issueItems = flatItems.filter((i) => i.type === 'issues');
  const wikiItems = flatItems.filter((i) => i.type === 'wiki');

  const renderGroup = (label: string, icon: React.ReactNode, items: FlatItem[]) => {
    if (items.length === 0) return null;
    return (
      <div>
        <div className="flex items-center gap-2 px-4 py-2 text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
          {icon}
          {label}
        </div>
        {items.map((item) => {
          const globalIdx = flatItems.indexOf(item);
          return (
            <button
              key={`${item.type}-${item.id}`}
              type="button"
              onClick={() => selectItem(item)}
              onMouseEnter={() => setActiveIndex(globalIdx)}
              className={cn(
                'flex w-full items-center justify-between mx-2 px-2 py-2.5 text-sm transition-colors rounded-md',
                globalIdx === activeIndex
                  ? 'bg-primary-light text-primary'
                  : 'text-text hover:bg-surface-tertiary',
              )}
            >
              <span className="truncate">{item.title}</span>
              {globalIdx === activeIndex && <ArrowRight className="h-3.5 w-3.5 flex-shrink-0" />}
            </button>
          );
        })}
      </div>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-backdrop backdrop-blur-sm" onClick={toggleSearch} />

      {/* Palette */}
      <div className="relative w-full max-w-xl rounded-xl border border-border bg-surface shadow-2xl animate-scale-in">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border-light">
          <Search className="h-5 w-5 text-text-tertiary flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search issues and wiki... (type:bug status:open)"
            className="flex-1 bg-transparent text-base text-text placeholder:text-text-tertiary outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center rounded bg-surface-tertiary px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary">
            ESC
          </kbd>
        </div>
        {/* Structured query hint */}
        {query.length === 0 && (
          <div className="flex items-center gap-1.5 px-4 py-2 text-[10px] text-text-tertiary border-b border-border-light">
            <Info className="h-3 w-3 flex-shrink-0" />
            <span>Use type:bug status:open priority:high assignee:name for advanced search</span>
          </div>
        )}

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {searchLoading && (
            <div className="flex items-center justify-center py-6">
              <Spinner className="h-4 w-4" />
            </div>
          )}
          {debouncedQuery.length > 1 && !searchLoading && flatItems.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-text-tertiary">
              No results found for &ldquo;{debouncedQuery}&rdquo;
            </p>
          )}
          {renderGroup('Issues', <FileText className="h-3.5 w-3.5" />, issueItems)}
          {renderGroup('Wiki', <BookOpen className="h-3.5 w-3.5" />, wikiItems)}
        </div>

        {/* Footer hint */}
        {flatItems.length > 0 && (
          <div className="flex items-center gap-3 border-t border-border-light px-4 py-2.5 text-[10px] text-text-tertiary">
            <span className="flex items-center gap-1">
              <kbd className="bg-surface-tertiary rounded px-1.5 py-0.5 font-medium">
                &uarr;&darr;
              </kbd>{' '}
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-surface-tertiary rounded px-1.5 py-0.5 font-medium">&crarr;</kbd>{' '}
              open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-surface-tertiary rounded px-1.5 py-0.5 font-medium">esc</kbd> close
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
