import {
  Filter,
  ArrowUpDown,
  LayoutList,
  LayoutGrid,
  Search,
  Bookmark,
  BookmarkCheck,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

interface SavedFilter {
  id: string;
  name: string;
  query: Record<string, string>;
}

interface IssueListToolbarProps {
  searchInput: string;
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;
  hasActiveSearch: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;
  sortField: string;
  sortDir: 'asc' | 'desc';
  onToggleSort: (field: 'createdAt' | 'updatedAt' | 'priority') => void;
  viewMode: 'list' | 'grid';
  onSetViewMode: (mode: 'list' | 'grid') => void;
  savedFilters: SavedFilter[];
  onApplySavedFilter: (query: Record<string, string>) => void;
  onDeleteSavedFilter: (id: string) => void;
  onSaveFilter: () => void;
  canSaveFilter: boolean;
}

/**
 *
 * @param root0
 * @param root0.searchInput
 * @param root0.onSearchChange
 * @param root0.onClearSearch
 * @param root0.hasActiveSearch
 * @param root0.onToggleFilters
 * @param root0.activeFilterCount
 * @param root0.sortField
 * @param root0.sortDir
 * @param root0.onToggleSort
 * @param root0.viewMode
 * @param root0.onSetViewMode
 * @param root0.savedFilters
 * @param root0.onApplySavedFilter
 * @param root0.onDeleteSavedFilter
 * @param root0.onSaveFilter
 * @param root0.canSaveFilter
 */
/**
 *
 * @param root0
 * @param root0.searchInput
 * @param root0.onSearchChange
 * @param root0.onClearSearch
 * @param root0.hasActiveSearch
 * @param root0.onToggleFilters
 * @param root0.activeFilterCount
 * @param root0.sortField
 * @param root0.sortDir
 * @param root0.onToggleSort
 * @param root0.viewMode
 * @param root0.onSetViewMode
 * @param root0.savedFilters
 * @param root0.onApplySavedFilter
 * @param root0.onDeleteSavedFilter
 * @param root0.onSaveFilter
 * @param root0.canSaveFilter
 */
export function IssueListToolbar({
  searchInput,
  onSearchChange,
  onClearSearch,
  hasActiveSearch,
  onToggleFilters,
  activeFilterCount,
  sortField,
  sortDir,
  onToggleSort,
  viewMode,
  onSetViewMode,
  savedFilters,
  onApplySavedFilter,
  onDeleteSavedFilter,
  onSaveFilter,
  canSaveFilter,
}: IssueListToolbarProps) {
  return (
    <div className="flex items-center gap-2 mb-4 bg-surface rounded-lg border border-border p-2">
      <div className="relative w-64">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary pointer-events-none" />
        <Input
          placeholder="Search issues..."
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-8 py-1.5 text-sm h-8"
        />
        {hasActiveSearch && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onClearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text p-0.5"
            title="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <Button variant="secondary" size="sm" onClick={onToggleFilters}>
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
            onClick={() => onToggleSort(field)}
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
                onClick={() => onApplySavedFilter(sf.query as Record<string, string>)}
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
                  onDeleteSavedFilter(sf.id);
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
      {canSaveFilter && (
        <Button variant="secondary" size="sm" onClick={onSaveFilter}>
          <Bookmark className="h-3.5 w-3.5" /> Save Filter
        </Button>
      )}

      <div className="ml-auto flex items-center gap-1 rounded-lg border border-border p-0.5">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onSetViewMode('list')}
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
          onClick={() => onSetViewMode('grid')}
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
  );
}
