import { Filter, User, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
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

interface IssueListFiltersProps {
  typeFilter: string[];
  setTypeFilter: (v: string[]) => void;
  priorityFilter: string[];
  setPriorityFilter: (v: string[]) => void;
  assigneeFilter: string[];
  setAssigneeFilter: (v: string[]) => void;
  labelFilter: string[];
  setLabelFilter: (v: string[]) => void;
  allAssignees: Assignee[];
  allLabels: Label[];
  activeFilterCount: number;
}

function toggleFilter(arr: string[], val: string, setter: (v: string[]) => void) {
  setter(arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val]);
}

/**
 *
 * @param root0
 * @param root0.typeFilter
 * @param root0.setTypeFilter
 * @param root0.priorityFilter
 * @param root0.setPriorityFilter
 * @param root0.assigneeFilter
 * @param root0.setAssigneeFilter
 * @param root0.labelFilter
 * @param root0.setLabelFilter
 * @param root0.allAssignees
 * @param root0.allLabels
 * @param root0.activeFilterCount
 */
export function IssueListFilters({
  typeFilter,
  setTypeFilter,
  priorityFilter,
  setPriorityFilter,
  assigneeFilter,
  setAssigneeFilter,
  labelFilter,
  setLabelFilter,
  allAssignees,
  allLabels,
  activeFilterCount,
}: IssueListFiltersProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3 mb-4 flex flex-wrap gap-4 items-start">
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
              onClick={() => toggleFilter(typeFilter, key, setTypeFilter)}
              className={cn(
                typeFilter.includes(key)
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
              onClick={() => toggleFilter(priorityFilter, key, setPriorityFilter)}
              className={cn(
                priorityFilter.includes(key)
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
                onClick={() => toggleFilter(assigneeFilter, a.id, setAssigneeFilter)}
                className={cn(
                  assigneeFilter.includes(a.id)
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
                onClick={() => toggleFilter(labelFilter, l.id, setLabelFilter)}
                className={cn(
                  labelFilter.includes(l.id)
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
      {activeFilterCount > 0 && (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            setTypeFilter([]);
            setPriorityFilter([]);
            setAssigneeFilter([]);
            setLabelFilter([]);
          }}
          className="text-text-tertiary hover:text-danger self-end"
        >
          <X className="h-3 w-3" /> Clear all
        </Button>
      )}
    </div>
  );
}
