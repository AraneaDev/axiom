import { Filter, Users, Layers, X, User, Check } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { PRIORITY_LABELS, ISSUE_TYPE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';

export type GroupBy = 'none' | 'assignee' | 'priority' | 'epic';

export interface Filters {
  assignee: string[];
  priority: string[];
  label: string[];
  type: string[];
}

export const EMPTY_FILTERS: Filters = { assignee: [], priority: [], label: [], type: [] };

function toggleFilter(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];
}

function FilterDropdown({
  label,
  icon,
  options,
  selected,
  onToggle,
}: {
  label: string;
  icon: React.ReactNode;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <Dropdown
      trigger={
        <Button
          variant="secondary"
          size="sm"
          className={cn(selected.length > 0 && 'border-primary text-primary')}
        >
          {icon} {label}
          {selected.length > 0 && (
            <span className="ml-1 bg-primary text-on-primary text-[10px] rounded-full px-1.5 py-0.5">
              {selected.length}
            </span>
          )}
        </Button>
      }
    >
      {options.length === 0 ? (
        <p className="px-3 py-2 text-xs text-text-tertiary">No options</p>
      ) : (
        options.map((opt) => (
          <DropdownItem
            key={opt.value}
            onClick={() => onToggle(opt.value)}
            className={cn(
              selected.includes(opt.value)
                ? 'bg-primary-light text-primary font-medium'
                : 'text-text',
            )}
          >
            <Check
              className={cn('h-3 w-3', selected.includes(opt.value) ? 'opacity-100' : 'opacity-0')}
            />
            {opt.label}
          </DropdownItem>
        ))
      )}
    </Dropdown>
  );
}

interface BoardFiltersProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  groupBy: GroupBy;
  onGroupByChange: (groupBy: GroupBy) => void;
  allAssignees: { id: string; displayName: string }[];
  allLabels: { id: string; name: string }[];
}

/**
 *
 * @param root0
 * @param root0.filters
 * @param root0.onFiltersChange
 * @param root0.groupBy
 * @param root0.onGroupByChange
 * @param root0.allAssignees
 * @param root0.allLabels
 */
export function BoardFilters({
  filters,
  onFiltersChange,
  groupBy,
  onGroupByChange,
  allAssignees,
  allLabels,
}: BoardFiltersProps) {
  const activeFilterCount =
    filters.assignee.length + filters.priority.length + filters.label.length + filters.type.length;

  return (
    <div className="flex items-center gap-2 mb-4 bg-surface rounded-lg border border-border p-2 flex-wrap">
      <FilterDropdown
        label="Assignee"
        icon={<Users className="h-3.5 w-3.5" />}
        options={allAssignees.map((a) => ({ value: a.id, label: a.displayName }))}
        selected={filters.assignee}
        onToggle={(v) =>
          onFiltersChange({ ...filters, assignee: toggleFilter(filters.assignee, v) })
        }
      />
      <FilterDropdown
        label="Priority"
        icon={<Filter className="h-3.5 w-3.5" />}
        options={Object.entries(PRIORITY_LABELS).map(([k, l]) => ({ value: k, label: l }))}
        selected={filters.priority}
        onToggle={(v) =>
          onFiltersChange({ ...filters, priority: toggleFilter(filters.priority, v) })
        }
      />
      <FilterDropdown
        label="Label"
        icon={<Filter className="h-3.5 w-3.5" />}
        options={allLabels.map((l) => ({ value: l.id, label: l.name }))}
        selected={filters.label}
        onToggle={(v) => onFiltersChange({ ...filters, label: toggleFilter(filters.label, v) })}
      />
      <FilterDropdown
        label="Type"
        icon={<Filter className="h-3.5 w-3.5" />}
        options={Object.entries(ISSUE_TYPE_LABELS).map(([k, l]) => ({ value: k, label: l }))}
        selected={filters.type}
        onToggle={(v) => onFiltersChange({ ...filters, type: toggleFilter(filters.type, v) })}
      />

      {activeFilterCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onFiltersChange(EMPTY_FILTERS)}
          className="text-text-tertiary hover:text-danger"
        >
          <X className="h-3.5 w-3.5" /> Clear filters
        </Button>
      )}

      <div className="ml-auto">
        <Dropdown
          align="right"
          trigger={
            <Button
              variant="secondary"
              size="sm"
              className={cn(groupBy !== 'none' && 'border-primary text-primary')}
            >
              <Layers className="h-3.5 w-3.5" /> Group by
              {groupBy !== 'none' && (
                <span className="ml-1 text-xs font-medium">
                  {groupBy === 'assignee'
                    ? 'Assignee'
                    : groupBy === 'priority'
                      ? 'Priority'
                      : 'Epic'}
                </span>
              )}
            </Button>
          }
        >
          {(
            [
              ['none', 'None', <X key="none" className="h-3.5 w-3.5" />],
              ['assignee', 'Assignee', <User key="assignee" className="h-3.5 w-3.5" />],
              ['priority', 'Priority', <Filter key="priority" className="h-3.5 w-3.5" />],
              ['epic', 'Epic', <Layers key="epic" className="h-3.5 w-3.5" />],
            ] as const
          ).map(([value, label, icon]) => (
            <DropdownItem
              key={value}
              onClick={() => onGroupByChange(value as GroupBy)}
              className={cn(
                groupBy === value ? 'bg-primary-light text-primary font-medium' : 'text-text',
              )}
            >
              {icon}
              {label}
            </DropdownItem>
          ))}
        </Dropdown>
      </div>
    </div>
  );
}
