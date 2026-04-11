import { Filter, Library, BookOpen, Tag, Calendar, X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';

interface WikiFiltersProps {
  spaceId: string;
  labelFilter: string;
  sinceFilter: string;
  untilFilter: string;
  allSpaces: Array<{ id: string; name: string }> | undefined;
  onSetFilter: (key: string, value: string) => void;
  onClearAllFilters: () => void;
  hasActiveFilters: boolean;
}

/**
 *
 * @param root0
 * @param root0.spaceId
 * @param root0.labelFilter
 * @param root0.sinceFilter
 * @param root0.untilFilter
 * @param root0.allSpaces
 * @param root0.onSetFilter
 * @param root0.onClearAllFilters
 * @param root0.hasActiveFilters
 */
export function WikiFilters({
  spaceId,
  labelFilter,
  sinceFilter,
  untilFilter,
  allSpaces,
  onSetFilter,
  onClearAllFilters,
  hasActiveFilters,
}: WikiFiltersProps) {
  const [labelInput, setLabelInput] = useState(labelFilter);

  return (
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
              ? allSpaces.find((s) => s.id === spaceId)?.name || 'Space'
              : 'All spaces'}
          </Button>
        }
      >
        <DropdownItem onClick={() => onSetFilter('spaceId', '')}>
          <Library className="h-3.5 w-3.5" /> All spaces
        </DropdownItem>
        {allSpaces?.map((s) => (
          <DropdownItem key={s.id} onClick={() => onSetFilter('spaceId', s.id)}>
            <BookOpen className="h-3.5 w-3.5" /> {s.name}
          </DropdownItem>
        ))}
      </Dropdown>

      {/* Label filter */}
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          onSetFilter('label', labelInput.trim());
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
        onChange={(e) => onSetFilter('since', e.target.value)}
        className="h-7 w-36 text-xs"
        title="Updated since"
      />

      {/* Until date */}
      <Input
        type="date"
        value={untilFilter}
        onChange={(e) => onSetFilter('until', e.target.value)}
        className="h-7 w-36 text-xs"
        title="Updated until"
      />

      {/* Clear all filters */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            onClearAllFilters();
            setLabelInput('');
          }}
        >
          <X className="h-3 w-3" /> Clear filters
        </Button>
      )}

      {/* Active filter badges */}
      {spaceId && allSpaces && (
        <Badge size="sm" variant="default">
          <Library className="h-3 w-3" />
          {allSpaces.find((s) => s.id === spaceId)?.name}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onSetFilter('spaceId', '')}
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
              onSetFilter('label', '');
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
            onClick={() => onSetFilter('since', '')}
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
            onClick={() => onSetFilter('until', '')}
            className="ml-1 p-0 hover:text-danger"
            title="Remove until filter"
          >
            <X className="h-3 w-3" />
          </Button>
        </Badge>
      )}
    </Card>
  );
}
