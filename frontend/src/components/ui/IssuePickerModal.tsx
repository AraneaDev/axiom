import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

import { Button } from './Button';
import { IssueTypeIcon } from './IssueTypeIcon';
import { Modal } from './Modal';
import { PriorityBadge } from './PriorityBadge';
import { Spinner } from './Spinner';

interface PickerIssue {
  id: string;
  number: number;
  title: string;
  type: string;
  priority: string;
}

interface IssuePickerModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onSelect: (issueId: string) => void;
  /** Fetch function: (projectId, search) => Promise<PickerIssue[]> */
  fetchIssues: (projectId: string, search: string) => Promise<PickerIssue[]>;
}

/**
 * Modal that lets users search for and select an issue.
 * @param props - Component props
 * @param props.open - Whether the modal is visible.
 * @param props.onClose - Callback to dismiss the modal.
 * @param props.projectId - Project to search within.
 * @param props.onSelect - Called with the selected issue id.
 * @param props.fetchIssues - Async function returning matching issues.
 */
export function IssuePickerModal({
  open,
  onClose,
  projectId,
  onSelect,
  fetchIssues,
}: IssuePickerModalProps) {
  const [search, setSearch] = useState('');

  const { data: issues = [], isFetching } = useQuery({
    queryKey: ['issue-picker', projectId, search],
    queryFn: () => fetchIssues(projectId, search),
    enabled: open && search.length >= 1,
    staleTime: 30_000,
  });

  function handleSelect(issueId: string) {
    onSelect(issueId);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Issue" size="sm">
      <div className="flex flex-col gap-3">
        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search issues..."
            autoFocus
            className={cn(
              'w-full pl-8 pr-3 py-2 text-sm rounded-md',
              'bg-surface border border-border text-text placeholder:text-text-tertiary',
              'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
            )}
          />
        </div>

        {/* Results */}
        <div className="flex flex-col min-h-[120px] max-h-64 overflow-y-auto">
          {isFetching && (
            <div className="flex items-center justify-center py-8">
              <Spinner size="sm" />
            </div>
          )}

          {!isFetching && search.length < 1 && (
            <p className="text-xs text-text-tertiary text-center py-8">Type to search for issues</p>
          )}

          {!isFetching && search.length >= 1 && issues.length === 0 && (
            <p className="text-xs text-text-tertiary text-center py-8">No issues found</p>
          )}

          {!isFetching &&
            issues.map((issue) => (
              <button
                key={issue.id}
                type="button"
                onClick={() => handleSelect(issue.id)}
                className={cn(
                  'flex items-center gap-2 px-2 py-2 rounded-md text-left w-full',
                  'hover:bg-surface-secondary transition-colors group',
                )}
                title={`Add ${issue.number}: ${issue.title}`}
              >
                <IssueTypeIcon type={issue.type} className="shrink-0 text-text-tertiary" />
                <span className="text-xs text-text-tertiary shrink-0">#{issue.number}</span>
                <span className="text-sm text-text truncate flex-1">{issue.title}</span>
                <PriorityBadge priority={issue.priority} display="short" className="shrink-0" />
                <Plus className="h-3.5 w-3.5 text-text-tertiary shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-border-light pt-3 -mx-5 px-5 -mb-4 pb-0">
          <Button variant="secondary" size="sm" onClick={onClose}>
            <span>Cancel</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
