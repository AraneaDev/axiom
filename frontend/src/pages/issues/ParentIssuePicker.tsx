import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, Search, X } from 'lucide-react';
import { useState } from 'react';

import { issuesApi } from '@/api/issues.api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { Spinner } from '@/components/ui/Spinner';
import type { Issue } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ParentIssuePickerProps {
  issue: Issue;
  projectId: string;
  num: string;
  isEditing: boolean;
  onEditField: (field: string | null) => void;
}

export function ParentIssuePicker({
  issue,
  projectId,
  num,
  isEditing,
  onEditField,
}: ParentIssuePickerProps) {
  const queryClient = useQueryClient();
  const [parentSearch, setParentSearch] = useState('');

  const { data: allIssues } = useQuery({
    queryKey: ['issues', projectId],
    queryFn: () => issuesApi.list(projectId, { limit: '200' }),
    enabled: isEditing,
  });

  const setParentMutation = useMutation({
    mutationFn: (parentIssueNumber: number | null) =>
      issuesApi.setParent(projectId, parseInt(num), parentIssueNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', projectId, num] });
      queryClient.invalidateQueries({ queryKey: ['issues', projectId] });
      queryClient.invalidateQueries({ queryKey: ['issue-children'] });
      queryClient.invalidateQueries({ queryKey: ['issue-progress'] });
      queryClient.invalidateQueries({ queryKey: ['roadmap', projectId] });
      onEditField(null);
      setParentSearch('');
    },
  });

  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-text-tertiary font-medium mb-1.5 flex items-center gap-1.5">
        Parent Issue
        {setParentMutation.isPending && <Spinner size="xs" />}
      </p>
      {isEditing ? (
        <div className="space-y-1">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-text-tertiary pointer-events-none" />
            <Input
              id="parent-search"
              type="text"
              placeholder="Search issues..."
              value={parentSearch}
              onChange={(e) => setParentSearch(e.target.value)}
              className="pl-7"
              autoFocus
            />
          </div>
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            <Button
              variant="outline"
              size="xs"
              onClick={() => setParentMutation.mutate(null)}
              className={cn(
                'w-full justify-start',
                !issue.parentId
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-text-secondary hover:border-primary',
              )}
            >
              <X className="h-3 w-3" /> No parent
            </Button>
            {allIssues?.issues
              ?.filter(
                (i) =>
                  i.number !== issue.number &&
                  (!parentSearch.trim() ||
                    i.title.toLowerCase().includes(parentSearch.toLowerCase()) ||
                    i.key.toLowerCase().includes(parentSearch.toLowerCase())),
              )
              .slice(0, 10)
              .map((i) => (
                <Button
                  key={i.id}
                  variant="outline"
                  size="xs"
                  onClick={() => setParentMutation.mutate(i.number)}
                  className={cn(
                    'w-full justify-start text-left',
                    issue.parentId === i.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-text-secondary hover:border-primary',
                  )}
                >
                  <IssueTypeIcon type={i.type} className="h-3 w-3 shrink-0" />
                  <span className="font-mono text-[10px] shrink-0">{i.key}</span>
                  <span className="truncate">{i.title}</span>
                </Button>
              ))}
          </div>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              onEditField(null);
              setParentSearch('');
            }}
            className="text-text-tertiary"
          >
            <X className="h-3 w-3" /> Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onEditField('parent')}
          className="hover:opacity-80"
        >
          {issue.parent ? (
            <>
              <IssueTypeIcon type="EPIC" className="h-3.5 w-3.5" />
              <span className="text-sm text-primary font-mono">{issue.parent.key}</span>
              <span className="text-sm truncate">{issue.parent.title}</span>
            </>
          ) : (
            <>
              <Network className="h-3.5 w-3.5" />
              <span className="text-sm text-text-secondary hover:text-primary transition-colors">
                Set parent
              </span>
            </>
          )}
        </Button>
      )}
    </div>
  );
}
