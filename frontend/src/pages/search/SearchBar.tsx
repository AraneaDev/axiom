import { Search, Bookmark, BookmarkPlus, Trash2, Info } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import type { SavedSearch } from '@/lib/types';

interface SearchBarProps {
  inputValue: string;
  onInputChange: (value: string) => void;
  onSearch: (query: string) => void;
  query: string;
  onSaveSearch: () => void;
  savedSearches: SavedSearch[] | undefined;
  onLoadSavedSearch: (saved: SavedSearch) => void;
  onDeleteSavedSearch: (id: string) => void;
}

/**
 * @param root0
 * @param root0.inputValue
 * @param root0.onInputChange
 * @param root0.onSearch
 * @param root0.query
 * @param root0.onSaveSearch
 * @param root0.savedSearches
 * @param root0.onLoadSavedSearch
 * @param root0.onDeleteSavedSearch
 */
export function SearchBar({
  inputValue,
  onInputChange,
  onSearch,
  query,
  onSaveSearch,
  savedSearches,
  onLoadSavedSearch,
  onDeleteSavedSearch,
}: SearchBarProps) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        <Search className="h-5 w-5 text-text-secondary" />
        <Input
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearch(inputValue);
          }}
          placeholder="Search issues and wiki pages..."
          className="flex-1 text-lg border-none outline-none bg-transparent placeholder:text-text-secondary text-text"
          autoFocus
        />
        <div className="flex items-center gap-2">
          {query && (
            <Button size="sm" variant="outline" onClick={onSaveSearch}>
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
                    onClick={() => onLoadSavedSearch(s)}
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
                      onDeleteSavedSearch(s.id);
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
  );
}
