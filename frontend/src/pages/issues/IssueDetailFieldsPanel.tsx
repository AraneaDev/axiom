import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Hash, Network, Pencil, Search, Target, User, X } from 'lucide-react';
import { useState } from 'react';

import { IssueDetailWorklog } from './IssueDetailWorklog';

import {
  customFieldsApi,
  type CustomFieldDefinition,
  type CustomFieldValue,
} from '@/api/custom-fields.api';
import { issuesApi } from '@/api/issues.api';
import { CustomFieldRenderer } from '@/components/CustomFieldRenderer';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { Spinner } from '@/components/ui/Spinner';
import { PRIORITY_COLORS, PRIORITY_LABELS, ISSUE_TYPE_LABELS } from '@/lib/constants';
import type { Issue, Sprint } from '@/lib/types';
import { cn } from '@/lib/utils';

interface TeamMember {
  user: { id: string; displayName: string };
}

interface IssueDetailFieldsPanelProps {
  issue: Issue;
  projectId: string;
  num: string;
  teamMembers: TeamMember[] | undefined;
  sprints: Sprint[];
  editingField: string | null;
  onEditField: (field: string | null) => void;
  onUpdate: (data: Record<string, unknown>) => void;
  isUpdating?: boolean;
}

/**
 *
 * @param root0
 * @param root0.issue
 * @param root0.projectId
 * @param root0.num
 * @param root0.teamMembers
 * @param root0.sprints
 * @param root0.editingField
 * @param root0.onEditField
 * @param root0.onUpdate
 * @param root0.isUpdating
 */
export function IssueDetailFieldsPanel({
  issue,
  projectId,
  num,
  teamMembers,
  sprints,
  editingField,
  onEditField,
  onUpdate,
  isUpdating,
}: IssueDetailFieldsPanelProps) {
  const queryClient = useQueryClient();
  const [parentSearch, setParentSearch] = useState('');

  const { data: allIssues } = useQuery({
    queryKey: ['issues', projectId],
    queryFn: () => issuesApi.list(projectId, { limit: '200' }),
    enabled: editingField === 'parent',
  });

  const { data: customFieldDefs = [] } = useQuery({
    queryKey: ['custom-fields', projectId],
    queryFn: () => customFieldsApi.listDefinitions(projectId),
    enabled: !!projectId,
  });

  const { data: customFieldValues = [] } = useQuery({
    queryKey: ['custom-field-values', issue.id],
    queryFn: () => customFieldsApi.getFieldValues(issue.id),
    enabled: !!issue.id,
  });

  const setFieldValueMutation = useMutation({
    mutationFn: ({ fieldId, value }: { fieldId: string; value: string }) =>
      customFieldsApi.setFieldValue(issue.id, fieldId, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-field-values', issue.id] });
    },
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
    <div className="rounded-lg border border-border bg-surface p-4">
      {/* Compact 2-column grid for short fields */}
      <div className="grid grid-cols-2 gap-3">
        {/* Status */}
        <div>
          <p className="text-xs uppercase tracking-wider text-text-tertiary font-medium mb-1.5">
            Status
          </p>
          <div className="flex items-center gap-1.5">
            <Badge variant="primary">{issue.column?.name ?? 'Backlog'}</Badge>
            {isUpdating && <Spinner size="xs" />}
          </div>
        </div>

        {/* Type */}
        <div>
          <p className="text-xs uppercase tracking-wider text-text-tertiary font-medium mb-1.5">
            Type
          </p>
          {editingField === 'type' ? (
            <div className="flex flex-wrap gap-1">
              {Object.entries(ISSUE_TYPE_LABELS).map(([key, label]) => (
                <Button
                  key={key}
                  variant="outline"
                  size="xs"
                  onClick={() => onUpdate({ type: key })}
                  className={cn(
                    issue.type === key
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-text-secondary hover:border-primary',
                  )}
                >
                  <IssueTypeIcon type={key} className="h-3 w-3" /> {label}
                </Button>
              ))}
            </div>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onEditField('type')}
              className="text-sm hover:text-primary"
            >
              <IssueTypeIcon type={issue.type} className="h-3.5 w-3.5" />{' '}
              {ISSUE_TYPE_LABELS[issue.type]}
            </Button>
          )}
        </div>

        {/* Priority */}
        <div>
          <p className="text-xs uppercase tracking-wider text-text-tertiary font-medium mb-1.5">
            Priority
          </p>
          {editingField === 'priority' ? (
            <div className="flex flex-wrap gap-1">
              {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                <Button
                  key={key}
                  variant="outline"
                  size="xs"
                  onClick={() => onUpdate({ priority: key })}
                  className={cn(
                    issue.priority === key
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-text-secondary hover:border-primary',
                  )}
                >
                  <Check
                    className={cn('h-3 w-3', issue.priority === key ? 'opacity-100' : 'opacity-0')}
                  />{' '}
                  {label}
                </Button>
              ))}
            </div>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onEditField('priority')}
              className="hover:opacity-80"
            >
              <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50" />
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLORS[issue.priority]}`}
              >
                {PRIORITY_LABELS[issue.priority]}
              </span>
            </Button>
          )}
        </div>

        {/* Assignee */}
        <div>
          <p className="text-xs uppercase tracking-wider text-text-tertiary font-medium mb-1.5">
            Assignee
          </p>
          {editingField === 'assignee' ? (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              <Button
                variant="outline"
                size="xs"
                onClick={() => onUpdate({ assigneeId: null })}
                className={cn(
                  'w-full justify-start',
                  !issue.assignee
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-text-secondary hover:border-primary',
                )}
              >
                <User className="h-3 w-3" /> Unassigned
              </Button>
              {teamMembers?.map((m) => (
                <Button
                  key={m.user.id}
                  variant="outline"
                  size="xs"
                  onClick={() => onUpdate({ assigneeId: m.user.id })}
                  className={cn(
                    'w-full justify-start',
                    issue.assignee?.id === m.user.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-text-secondary hover:border-primary',
                  )}
                >
                  <Avatar name={m.user.displayName} size="sm" />
                  {m.user.displayName}
                </Button>
              ))}
            </div>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onEditField('assignee')}
              className="hover:opacity-80"
            >
              {issue.assignee ? (
                <>
                  <Avatar name={issue.assignee.displayName} size="sm" />
                  <span className="text-sm">{issue.assignee.displayName}</span>
                </>
              ) : (
                <>
                  <User className="h-3.5 w-3.5" />
                  <span className="text-sm text-text-secondary hover:text-primary transition-colors">
                    Unassigned
                  </span>
                </>
              )}
            </Button>
          )}
        </div>

        {/* Story Points */}
        <div>
          <p className="text-xs uppercase tracking-wider text-text-tertiary font-medium mb-1.5">
            Story Points
          </p>
          {editingField === 'storyPoints' ? (
            <div className="flex items-center gap-1">
              <Input
                id="story-points"
                type="number"
                min={0}
                max={100}
                defaultValue={issue.storyPoints ?? ''}
                className="w-16"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value;
                    onUpdate({ storyPoints: val ? parseInt(val) : null });
                  }
                  if (e.key === 'Escape') onEditField(null);
                }}
                onBlur={(e) => {
                  const val = (e.target as HTMLInputElement).value;
                  onUpdate({ storyPoints: val ? parseInt(val) : null });
                }}
              />
            </div>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onEditField('storyPoints')}
              className="hover:opacity-80"
            >
              <Hash className="h-3 w-3" />
              <span className="text-sm">
                {issue.storyPoints != null ? `${issue.storyPoints} points` : 'Set points'}
              </span>
            </Button>
          )}
        </div>

        {/* Sprint */}
        <div>
          <p className="text-xs uppercase tracking-wider text-text-tertiary font-medium mb-1.5">
            Sprint
          </p>
          {editingField === 'sprint' ? (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              <Button
                variant="outline"
                size="xs"
                onClick={() => onUpdate({ sprintId: null })}
                className={cn(
                  'w-full justify-start',
                  !issue.sprintId
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-text-secondary hover:border-primary',
                )}
              >
                <Target className="h-3 w-3" /> Backlog
              </Button>
              {sprints
                .filter((s) => s.status !== 'COMPLETED')
                .map((s) => (
                  <Button
                    key={s.id}
                    variant="outline"
                    size="xs"
                    onClick={() => onUpdate({ sprintId: s.id })}
                    className={cn(
                      'w-full justify-start',
                      issue.sprintId === s.id
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-text-secondary hover:border-primary',
                    )}
                  >
                    <Target className="h-3 w-3" /> {s.name}
                  </Button>
                ))}
            </div>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onEditField('sprint')}
              className="hover:opacity-80"
            >
              <Target className="h-3.5 w-3.5" />
              <span className="text-sm text-text-secondary hover:text-primary transition-colors">
                {issue.sprint?.name ?? 'Backlog'}
              </span>
            </Button>
          )}
        </div>

        {/* Due date */}
        <div>
          <p className="text-xs uppercase tracking-wider text-text-tertiary font-medium mb-1.5">
            Due date
          </p>
          <Input
            id="due-date"
            type="date"
            value={issue.dueDate ? new Date(issue.dueDate).toISOString().split('T')[0] : ''}
            onChange={(e) => onUpdate({ dueDate: e.target.value || null })}
          />
        </div>

        {/* Parent Issue */}
        <div>
          <p className="text-xs uppercase tracking-wider text-text-tertiary font-medium mb-1.5 flex items-center gap-1.5">
            Parent Issue
            {setParentMutation.isPending && <Spinner size="xs" />}
          </p>
          {editingField === 'parent' ? (
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
      </div>

      {/* Full-width sections below the grid */}

      {/* Labels */}
      {issue.labels?.length > 0 && (
        <div className="border-t border-border-light pt-3 mt-4">
          <p className="text-xs uppercase tracking-wider text-text-tertiary font-medium mb-1.5">
            Labels
          </p>
          <div className="flex flex-wrap gap-1">
            {issue.labels.map((l) => (
              <Badge key={l.id}>{l.name}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Custom Fields */}
      {customFieldDefs.length > 0 && (
        <div className="border-t border-border-light pt-3 mt-4">
          <p className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-2 flex items-center gap-1.5">
            Custom Fields
            {setFieldValueMutation.isPending && <Spinner size="xs" />}
          </p>
          <div className="space-y-2">
            {customFieldDefs.map((def: CustomFieldDefinition) => {
              const fieldValue = customFieldValues.find(
                (v: CustomFieldValue) => v.fieldDefinitionId === def.id,
              );
              return (
                <div key={def.id}>
                  <p className="text-xs text-text-tertiary mb-0.5">{def.name}</p>
                  <CustomFieldRenderer
                    definition={def}
                    value={fieldValue?.value}
                    onChange={(value) => setFieldValueMutation.mutate({ fieldId: def.id, value })}
                    teamMembers={teamMembers}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Time Tracking */}
      <div className="border-t border-border-light pt-3 mt-4">
        <IssueDetailWorklog
          issue={issue}
          projectId={projectId}
          num={num}
          editingField={editingField}
          onEditField={onEditField}
          onUpdate={onUpdate}
        />
      </div>
    </div>
  );
}
