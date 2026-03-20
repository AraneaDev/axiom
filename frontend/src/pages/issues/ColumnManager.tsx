import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, GripVertical, Save, Check, X } from 'lucide-react';
import { useState, useRef, useCallback } from 'react';

import { issuesApi } from '@/api/issues.api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import type { BoardColumn } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ColumnManagerProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  columns: BoardColumn[];
}

interface ColumnRow {
  id: string;
  name: string;
  isDone: boolean;
  isDefault: boolean;
  issueCount: number;
}

/**
 *
 * @param root0
 * @param root0.open
 * @param root0.onClose
 * @param root0.projectId
 * @param root0.columns
 */
export function ColumnManager({ open, onClose, projectId, columns }: ColumnManagerProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [rows, setRows] = useState<ColumnRow[]>(() =>
    columns.map((c) => ({
      id: c.id,
      name: c.name,
      isDone: c.isDone,
      isDefault: c.isDefault,
      issueCount: c.issues.length,
    })),
  );
  const [newName, setNewName] = useState('');
  const [newIsDone, setNewIsDone] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const dragItem = useRef<number | null>(null);
  const dragOver = useRef<number | null>(null);

  const invalidateBoard = () => {
    queryClient.invalidateQueries({ queryKey: ['board', projectId] });
  };

  const createMutation = useMutation({
    mutationFn: (data: { name: string; isDone?: boolean }) =>
      issuesApi.createColumn(projectId, data),
    onSuccess: (col) => {
      setRows((prev) => [
        ...prev,
        { id: col.id, name: col.name, isDone: col.isDone, isDefault: col.isDefault, issueCount: 0 },
      ]);
      setNewName('');
      setNewIsDone(false);
      invalidateBoard();
    },
    onError: () => toast.error('Failed to create column'),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      columnId,
      data,
    }: {
      columnId: string;
      data: { name?: string; isDone?: boolean };
    }) => issuesApi.updateColumn(projectId, columnId, data),
    onSuccess: () => invalidateBoard(),
    onError: () => toast.error('Failed to update column'),
  });

  const deleteMutation = useMutation({
    mutationFn: (columnId: string) => issuesApi.deleteColumn(projectId, columnId),
    onSuccess: (_, columnId) => {
      setRows((prev) => prev.filter((r) => r.id !== columnId));
      invalidateBoard();
    },
    onError: () => toast.error('Cannot delete column. Move issues first.'),
  });

  const reorderMutation = useMutation({
    mutationFn: (positions: { id: string; position: number }[]) =>
      issuesApi.reorderColumns(projectId, positions),
    onSuccess: () => invalidateBoard(),
    onError: () => toast.error('Failed to reorder columns'),
  });

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    createMutation.mutate({ name: trimmed, isDone: newIsDone });
  };

  const handleStartEdit = (row: ColumnRow) => {
    setEditingId(row.id);
    setEditingName(row.name);
  };

  const handleSaveEdit = (row: ColumnRow) => {
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === row.name) {
      setEditingId(null);
      return;
    }
    updateMutation.mutate({ columnId: row.id, data: { name: trimmed } });
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, name: trimmed } : r)));
    setEditingId(null);
  };

  const handleToggleDone = (row: ColumnRow) => {
    const newVal = !row.isDone;
    updateMutation.mutate({ columnId: row.id, data: { isDone: newVal } });
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, isDone: newVal } : r)));
  };

  const handleDragStart = useCallback((index: number) => {
    dragItem.current = index;
  }, []);

  const handleDragEnter = useCallback((index: number) => {
    dragOver.current = index;
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragItem.current === null || dragOver.current === null) return;
    if (dragItem.current === dragOver.current) return;

    setRows((prev) => {
      const copy = [...prev];
      const dragged = copy.splice(dragItem.current!, 1)[0];
      copy.splice(dragOver.current!, 0, dragged);
      const positions = copy.map((r, i) => ({ id: r.id, position: i }));
      reorderMutation.mutate(positions);
      return copy;
    });

    dragItem.current = null;
    dragOver.current = null;
  }, [reorderMutation]);

  return (
    <Modal open={open} onClose={onClose} title="Manage Board Columns" size="md">
      <div className="space-y-1">
        {rows.map((row, index) => (
          <div
            key={row.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragEnter={() => handleDragEnter(index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => e.preventDefault()}
            className={cn(
              'flex items-center gap-2 rounded-md border border-border px-2 py-2 bg-surface',
              'hover:bg-surface-secondary cursor-grab active:cursor-grabbing',
            )}
          >
            <GripVertical className="h-4 w-4 text-text-tertiary shrink-0" />

            {editingId === row.id ? (
              <input
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveEdit(row);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="flex-1 bg-transparent border-b border-primary text-sm text-text outline-none px-1 py-0.5"
                autoFocus
              />
            ) : (
              <button
                onClick={() => handleStartEdit(row)}
                className="flex-1 text-left text-sm text-text truncate"
                title="Click to edit name"
              >
                {row.name}
              </button>
            )}

            {editingId === row.id ? (
              <div className="flex gap-1">
                <button
                  onClick={() => handleSaveEdit(row)}
                  className="p-1 rounded text-success hover:bg-surface-tertiary"
                  title="Save"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="p-1 rounded text-text-tertiary hover:bg-surface-tertiary"
                  title="Cancel"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => handleToggleDone(row)}
                  className={cn(
                    'text-xs px-1.5 py-0.5 rounded-full border shrink-0',
                    row.isDone
                      ? 'bg-success/10 text-success border-success/30'
                      : 'bg-surface-tertiary text-text-tertiary border-border-light',
                  )}
                  title={row.isDone ? 'Marks issues as done' : 'Click to mark as done column'}
                >
                  {row.isDone ? 'Done' : 'Active'}
                </button>

                {row.isDefault && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary-light text-primary shrink-0">
                    Default
                  </span>
                )}

                <span className="text-xs text-text-tertiary shrink-0">{row.issueCount}</span>

                <button
                  onClick={() => deleteMutation.mutate(row.id)}
                  disabled={row.isDefault || row.issueCount > 0}
                  className={cn(
                    'p-1 rounded shrink-0',
                    row.isDefault || row.issueCount > 0
                      ? 'text-text-tertiary/30 cursor-not-allowed'
                      : 'text-danger hover:bg-danger-light',
                  )}
                  title={
                    row.isDefault
                      ? 'Cannot delete default column'
                      : row.issueCount > 0
                        ? 'Move issues before deleting'
                        : 'Delete column'
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="New column"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            placeholder="Column name"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-text-secondary pb-2 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={newIsDone}
            onChange={(e) => setNewIsDone(e.target.checked)}
            className="accent-primary"
          />
          Done
        </label>
        <div className="pb-0.5">
          <Button size="sm" onClick={handleCreate} disabled={!newName.trim()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </div>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          <Save className="h-4 w-4" /> Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}
