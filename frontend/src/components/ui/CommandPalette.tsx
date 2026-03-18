import { useQuery } from '@tanstack/react-query';
import { Search, FileText, BookOpen, ArrowRight } from 'lucide-react';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';

import { searchApi } from '@/api/search.api';
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
  const { data: results } = useQuery({
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
  const selectItem = useCallback(
    (item: FlatItem) => {
      toggleSearch();
      navigate(item.url);
    },
    [navigate, toggleSearch],
  );

  /* ---- keyboard navigation ---- */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        toggleSearch();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % Math.max(flatItems.length, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + flatItems.length) % Math.max(flatItems.length, 1));
      } else if (e.key === 'Enter' && flatItems[activeIndex]) {
        e.preventDefault();
        selectItem(flatItems[activeIndex]);
      }
    },
    [flatItems, activeIndex, selectItem, toggleSearch],
  );

  /* ---- group items for display ---- */
  if (!searchOpen) return null;

  const issueItems = flatItems.filter((i) => i.type === 'issues');
  const wikiItems = flatItems.filter((i) => i.type === 'wiki');

  const renderGroup = (label: string, icon: React.ReactNode, items: FlatItem[]) => {
    if (items.length === 0) return null;
    return (
      <div>
        <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-text-tertiary uppercase tracking-wider">
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
                'flex w-full items-center justify-between px-4 py-2.5 text-sm transition-colors',
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
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={toggleSearch} />

      {/* Palette */}
      <div className="relative w-full max-w-xl rounded-xl border border-border bg-surface-elevated shadow-2xl animate-fade-in">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-light">
          <Search className="h-4 w-4 text-text-tertiary flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search issues, wiki pages..."
            className="flex-1 bg-transparent text-sm text-text placeholder:text-text-tertiary outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {debouncedQuery.length > 1 && flatItems.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-text-tertiary">
              No results found for &ldquo;{debouncedQuery}&rdquo;
            </p>
          )}
          {renderGroup('Issues', <FileText className="h-3.5 w-3.5" />, issueItems)}
          {renderGroup('Wiki', <BookOpen className="h-3.5 w-3.5" />, wikiItems)}
        </div>

        {/* Footer hint */}
        {flatItems.length > 0 && (
          <div className="flex items-center gap-4 border-t border-border-light px-4 py-2 text-[10px] text-text-tertiary">
            <span>
              <kbd className="font-semibold">&uarr;&darr;</kbd> navigate
            </span>
            <span>
              <kbd className="font-semibold">&crarr;</kbd> open
            </span>
            <span>
              <kbd className="font-semibold">esc</kbd> close
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
