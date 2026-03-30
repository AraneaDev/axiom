import { AlertTriangle, CheckSquare, Columns, Target, Trash2, User, X } from 'lucide-react';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { PRIORITY_LABELS } from '@/lib/constants';
import type { TeamMember } from '@/lib/issue-types';

interface BoardColumn {
  id: string;
  name: string;
}

interface Sprint {
  id: string;
  name: string;
  status: string;
}

interface IssueListBulkActionsProps {
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: (v: boolean) => void;
  boardColumns: BoardColumn[];
  teamMembers: TeamMember[];
  sprints: Sprint[];
  onBulkUpdate: (data: {
    issueIds: string[];
    updates: {
      status?: string;
      assigneeId?: string | null;
      priority?: string;
      sprintId?: string | null;
    };
  }) => void;
  onBulkDelete: (ids: string[]) => void;
  isBulkDeletePending: boolean;
}

/**
 *
 * @param root0
 * @param root0.selectedIds
 * @param root0.setSelectedIds
 * @param root0.showDeleteConfirm
 * @param root0.setShowDeleteConfirm
 * @param root0.boardColumns
 * @param root0.teamMembers
 * @param root0.sprints
 * @param root0.onBulkUpdate
 * @param root0.onBulkDelete
 * @param root0.isBulkDeletePending
 */
export function IssueListBulkActions({
  selectedIds,
  setSelectedIds,
  showDeleteConfirm,
  setShowDeleteConfirm,
  boardColumns,
  teamMembers,
  sprints,
  onBulkUpdate,
  onBulkDelete,
  isBulkDeletePending,
}: IssueListBulkActionsProps) {
  const ids = Array.from(selectedIds);

  return (
    <div className="rounded-lg border border-primary/30 bg-primary-light/10 p-2 mb-4 flex items-center gap-2 flex-wrap">
      <span className="text-sm font-medium text-text px-2">
        <CheckSquare className="h-4 w-4 inline mr-1" />
        {selectedIds.size} issue{selectedIds.size !== 1 ? 's' : ''} selected
      </span>
      <div className="h-4 w-px bg-border mx-1" />

      {/* Set Status */}
      <Dropdown
        trigger={
          <Button variant="secondary" size="xs">
            <Columns className="h-3 w-3" /> Set Status
          </Button>
        }
      >
        {boardColumns.map((col) => (
          <DropdownItem
            key={col.id}
            onClick={() => onBulkUpdate({ issueIds: ids, updates: { status: col.id } })}
          >
            <Columns className="h-3 w-3" /> {col.name}
          </DropdownItem>
        ))}
      </Dropdown>

      {/* Assign */}
      <Dropdown
        trigger={
          <Button variant="secondary" size="xs">
            <User className="h-3 w-3" /> Assign
          </Button>
        }
      >
        <DropdownItem
          onClick={() => onBulkUpdate({ issueIds: ids, updates: { assigneeId: null } })}
        >
          <User className="h-3 w-3" /> Unassigned
        </DropdownItem>
        {teamMembers.map((m) => (
          <DropdownItem
            key={m.user.id}
            onClick={() => onBulkUpdate({ issueIds: ids, updates: { assigneeId: m.user.id } })}
          >
            <Avatar name={m.user.displayName} size="sm" /> {m.user.displayName}
          </DropdownItem>
        ))}
      </Dropdown>

      {/* Set Priority */}
      <Dropdown
        trigger={
          <Button variant="secondary" size="xs">
            <AlertTriangle className="h-3 w-3" /> Priority
          </Button>
        }
      >
        {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
          <DropdownItem
            key={key}
            onClick={() => onBulkUpdate({ issueIds: ids, updates: { priority: key } })}
          >
            <AlertTriangle className="h-3 w-3" /> {label}
          </DropdownItem>
        ))}
      </Dropdown>

      {/* Move to Sprint */}
      <Dropdown
        trigger={
          <Button variant="secondary" size="xs">
            <Target className="h-3 w-3" /> Sprint
          </Button>
        }
      >
        <DropdownItem onClick={() => onBulkUpdate({ issueIds: ids, updates: { sprintId: null } })}>
          <Target className="h-3 w-3" /> Backlog
        </DropdownItem>
        {sprints
          .filter((s) => s.status !== 'COMPLETED')
          .map((s) => (
            <DropdownItem
              key={s.id}
              onClick={() => onBulkUpdate({ issueIds: ids, updates: { sprintId: s.id } })}
            >
              <Target className="h-3 w-3" /> {s.name}
            </DropdownItem>
          ))}
      </Dropdown>

      {/* Delete */}
      {showDeleteConfirm ? (
        <div className="flex items-center gap-1 ml-2">
          <span className="text-xs text-danger">
            Delete {selectedIds.size} issue{selectedIds.size !== 1 ? 's' : ''}?
          </span>
          <Button
            variant="danger"
            size="xs"
            onClick={() => onBulkDelete(ids)}
            disabled={isBulkDeletePending}
          >
            <Trash2 className="h-3 w-3" /> Confirm
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setShowDeleteConfirm(false)}>
            <X className="h-3 w-3" /> Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setShowDeleteConfirm(true)}
          className="text-danger hover:text-danger hover:bg-danger-light ml-2"
        >
          <Trash2 className="h-3 w-3" /> Delete
        </Button>
      )}

      <div className="ml-auto">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            setSelectedIds(new Set());
            setShowDeleteConfirm(false);
          }}
          className="text-text-tertiary"
        >
          <X className="h-3 w-3" /> Clear selection
        </Button>
      </div>
    </div>
  );
}
