import {
  AlertTriangle,
  CheckSquare,
  ChevronDown,
  Columns,
  Target,
  Trash2,
  User,
  X,
} from 'lucide-react';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { PRIORITY_LABELS } from '@/lib/constants';

interface BoardColumn {
  id: string;
  name: string;
}

interface TeamMember {
  user: { id: string; displayName: string };
}

interface Sprint {
  id: string;
  name: string;
  status: string;
}

interface IssueListBulkActionsProps {
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  bulkDropdown: string | null;
  setBulkDropdown: (v: string | null) => void;
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
 * @param root0.bulkDropdown
 * @param root0.setBulkDropdown
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
  bulkDropdown,
  setBulkDropdown,
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
      <div className="relative">
        <Button
          variant="secondary"
          size="xs"
          onClick={() => setBulkDropdown(bulkDropdown === 'status' ? null : 'status')}
        >
          <Columns className="h-3 w-3" /> Set Status <ChevronDown className="h-3 w-3" />
        </Button>
        {bulkDropdown === 'status' && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setBulkDropdown(null)} />
            <div className="absolute left-0 top-full mt-1 w-44 rounded-lg border border-border bg-surface-elevated shadow-lg py-1 z-20">
              {boardColumns.map((col) => (
                <Button
                  key={col.id}
                  variant="ghost"
                  size="xs"
                  className="w-full justify-start rounded-none"
                  onClick={() => onBulkUpdate({ issueIds: ids, updates: { status: col.id } })}
                >
                  <Columns className="h-3 w-3" /> {col.name}
                </Button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Assign */}
      <div className="relative">
        <Button
          variant="secondary"
          size="xs"
          onClick={() => setBulkDropdown(bulkDropdown === 'assign' ? null : 'assign')}
        >
          <User className="h-3 w-3" /> Assign <ChevronDown className="h-3 w-3" />
        </Button>
        {bulkDropdown === 'assign' && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setBulkDropdown(null)} />
            <div className="absolute left-0 top-full mt-1 w-48 rounded-lg border border-border bg-surface-elevated shadow-lg py-1 z-20 max-h-48 overflow-y-auto">
              <Button
                variant="ghost"
                size="xs"
                className="w-full justify-start rounded-none"
                onClick={() => onBulkUpdate({ issueIds: ids, updates: { assigneeId: null } })}
              >
                <User className="h-3 w-3" /> Unassigned
              </Button>
              {teamMembers.map((m) => (
                <Button
                  key={m.user.id}
                  variant="ghost"
                  size="xs"
                  className="w-full justify-start rounded-none"
                  onClick={() =>
                    onBulkUpdate({ issueIds: ids, updates: { assigneeId: m.user.id } })
                  }
                >
                  <Avatar name={m.user.displayName} size="sm" /> {m.user.displayName}
                </Button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Set Priority */}
      <div className="relative">
        <Button
          variant="secondary"
          size="xs"
          onClick={() => setBulkDropdown(bulkDropdown === 'priority' ? null : 'priority')}
        >
          <AlertTriangle className="h-3 w-3" /> Priority <ChevronDown className="h-3 w-3" />
        </Button>
        {bulkDropdown === 'priority' && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setBulkDropdown(null)} />
            <div className="absolute left-0 top-full mt-1 w-40 rounded-lg border border-border bg-surface-elevated shadow-lg py-1 z-20">
              {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                <Button
                  key={key}
                  variant="ghost"
                  size="xs"
                  className="w-full justify-start rounded-none"
                  onClick={() => onBulkUpdate({ issueIds: ids, updates: { priority: key } })}
                >
                  <AlertTriangle className="h-3 w-3" /> {label}
                </Button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Move to Sprint */}
      <div className="relative">
        <Button
          variant="secondary"
          size="xs"
          onClick={() => setBulkDropdown(bulkDropdown === 'sprint' ? null : 'sprint')}
        >
          <Target className="h-3 w-3" /> Sprint <ChevronDown className="h-3 w-3" />
        </Button>
        {bulkDropdown === 'sprint' && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setBulkDropdown(null)} />
            <div className="absolute left-0 top-full mt-1 w-48 rounded-lg border border-border bg-surface-elevated shadow-lg py-1 z-20 max-h-48 overflow-y-auto">
              <Button
                variant="ghost"
                size="xs"
                className="w-full justify-start rounded-none"
                onClick={() => onBulkUpdate({ issueIds: ids, updates: { sprintId: null } })}
              >
                <Target className="h-3 w-3" /> Backlog
              </Button>
              {sprints
                .filter((s) => s.status !== 'COMPLETED')
                .map((s) => (
                  <Button
                    key={s.id}
                    variant="ghost"
                    size="xs"
                    className="w-full justify-start rounded-none"
                    onClick={() => onBulkUpdate({ issueIds: ids, updates: { sprintId: s.id } })}
                  >
                    <Target className="h-3 w-3" /> {s.name}
                  </Button>
                ))}
            </div>
          </>
        )}
      </div>

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
            setBulkDropdown(null);
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
