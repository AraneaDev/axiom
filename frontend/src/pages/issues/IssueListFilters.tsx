import { Filter, User, X, Timer, Columns, Code } from 'lucide-react';
import { useState } from 'react';

import { QueryBar } from '@/components/issues/QueryBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import type { FilterState } from '@/hooks/useIssueListFilters';
import { PRIORITY_LABELS, ISSUE_TYPE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';

interface Assignee {
  id: string;
  displayName: string;
}

interface Label {
  id: string;
  name: string;
}

interface Sprint {
  id: string;
  name: string;
}

interface Column {
  id: string;
  name: string;
}

interface IssueListFiltersProps {
  filters: FilterState;
  setFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  clearFilters: () => void;
  allAssignees: Assignee[];
  allLabels: Label[];
  allSprints: Sprint[];
  allColumns: Column[];
  activeFilterCount: number;
  queryString?: string;
  onQueryChange?: (q: string) => void;
}

function toggleArrayFilter(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];
}

/**
 *
 * @param root0
 * @param root0.filters
 * @param root0.setFilter
 * @param root0.clearFilters
 * @param root0.allAssignees
 * @param root0.allLabels
 * @param root0.allSprints
 * @param root0.allColumns
 * @param root0.activeFilterCount
 * @param root0.queryString
 * @param root0.onQueryChange
 */
export function IssueListFilters({
  filters,
  setFilter,
  clearFilters,
  allAssignees,
  allLabels,
  allSprints,
  allColumns,
  activeFilterCount,
  queryString = '',
  onQueryChange,
}: IssueListFiltersProps) {
  const [queryMode, setQueryMode] = useState(false);

  return (
    <Card className="p-3 mb-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="xs"
          title={queryMode ? 'Switch to filter mode' : 'Switch to query mode'}
          onClick={() => setQueryMode(!queryMode)}
          className={cn(queryMode && 'text-primary bg-primary/10')}
        >
          <Code className="h-3.5 w-3.5" />
        </Button>
        {queryMode ? (
          <div className="flex-1">
            <QueryBar value={queryString} onChange={(q) => onQueryChange?.(q)} />
          </div>
        ) : null}
      </div>
      {!queryMode && (
        <div className="flex flex-wrap gap-4 items-start">
          <div>
            <p className="text-xs uppercase tracking-wider text-text-tertiary font-medium mb-1.5">
              Type
            </p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(ISSUE_TYPE_LABELS).map(([key, label]) => (
                <Button
                  key={key}
                  variant="outline"
                  size="xs"
                  onClick={() => setFilter('type', toggleArrayFilter(filters.type, key))}
                  className={cn(
                    filters.type.includes(key)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-text-secondary hover:border-border-focus',
                  )}
                >
                  <IssueTypeIcon type={key} className="h-3 w-3" /> {label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-text-tertiary font-medium mb-1.5">
              Priority
            </p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                <Button
                  key={key}
                  variant="outline"
                  size="xs"
                  onClick={() => setFilter('priority', toggleArrayFilter(filters.priority, key))}
                  className={cn(
                    filters.priority.includes(key)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-text-secondary hover:border-border-focus',
                  )}
                >
                  <Filter className="h-3 w-3" /> {label}
                </Button>
              ))}
            </div>
          </div>
          {allAssignees.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider text-text-tertiary font-medium mb-1.5">
                Assignee
              </p>
              <div className="flex flex-wrap gap-1">
                {allAssignees.map((a) => (
                  <Button
                    key={a.id}
                    variant="outline"
                    size="xs"
                    onClick={() => setFilter('assignee', toggleArrayFilter(filters.assignee, a.id))}
                    className={cn(
                      filters.assignee.includes(a.id)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-text-secondary hover:border-border-focus',
                    )}
                  >
                    <User className="h-3 w-3" /> {a.displayName}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {allLabels.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider text-text-tertiary font-medium mb-1.5">
                Label
              </p>
              <div className="flex flex-wrap gap-1">
                {allLabels.map((l) => (
                  <Button
                    key={l.id}
                    variant="outline"
                    size="xs"
                    onClick={() => setFilter('label', toggleArrayFilter(filters.label, l.id))}
                    className={cn(
                      filters.label.includes(l.id)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-text-secondary hover:border-border-focus',
                    )}
                  >
                    <Filter className="h-3 w-3" /> {l.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-xs uppercase tracking-wider text-text-tertiary font-medium mb-1.5">
              Sprint
            </p>
            <div className="flex flex-wrap gap-1">
              <Button
                variant="outline"
                size="xs"
                onClick={() => setFilter('sprint', filters.sprint === 'none' ? '' : 'none')}
                className={cn(
                  filters.sprint === 'none'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-text-secondary hover:border-border-focus',
                )}
              >
                <Timer className="h-3 w-3" /> No sprint
              </Button>
              {allSprints.map((s) => (
                <Button
                  key={s.id}
                  variant="outline"
                  size="xs"
                  onClick={() => setFilter('sprint', filters.sprint === s.id ? '' : s.id)}
                  className={cn(
                    filters.sprint === s.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-text-secondary hover:border-border-focus',
                  )}
                >
                  <Timer className="h-3 w-3" /> {s.name}
                </Button>
              ))}
            </div>
          </div>
          {allColumns.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider text-text-tertiary font-medium mb-1.5">
                Status
              </p>
              <div className="flex flex-wrap gap-1">
                {allColumns.map((c) => (
                  <Button
                    key={c.id}
                    variant="outline"
                    size="xs"
                    onClick={() => setFilter('column', filters.column === c.id ? '' : c.id)}
                    className={cn(
                      filters.column === c.id
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-text-secondary hover:border-border-focus',
                    )}
                  >
                    <Columns className="h-3 w-3" /> {c.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={clearFilters}
              className="text-text-tertiary hover:text-danger self-end"
            >
              <X className="h-3 w-3" /> Clear all
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
