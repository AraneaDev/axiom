import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';

import { useToast } from '@/components/ui/Toast';

interface UseCRUDSettingsConfig<TCreateData, TUpdateData, TDeleteId> {
  queryKey: unknown[];
  createFn: (data: TCreateData) => Promise<unknown>;
  updateFn: (id: TDeleteId, data: TUpdateData) => Promise<unknown>;
  deleteFn: (id: TDeleteId) => Promise<unknown>;
  entityName: string;
  onCreateSuccess?: () => void;
  onUpdateSuccess?: () => void;
}

/**
 * Generic hook for CRUD operations in settings pages.
 * Manages add/edit/delete UI state, mutations, query invalidation, and toast notifications.
 * @param root0
 * @param root0.queryKey
 * @param root0.createFn
 * @param root0.updateFn
 * @param root0.deleteFn
 * @param root0.entityName
 * @param root0.onCreateSuccess
 * @param root0.onUpdateSuccess
 */
export function useCRUDSettings<
  TCreateData,
  TUpdateData = Partial<TCreateData>,
  TDeleteId = string,
>({
  queryKey,
  createFn,
  updateFn,
  deleteFn,
  entityName,
  onCreateSuccess,
  onUpdateSuccess,
}: UseCRUDSettingsConfig<TCreateData, TUpdateData, TDeleteId>) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<TDeleteId | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TDeleteId | null>(null);

  const resetForm = useCallback(() => {
    setShowAddForm(false);
    setEditingId(null);
  }, []);

  const createMutation = useMutation({
    mutationFn: (data: TCreateData) => createFn(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      resetForm();
      onCreateSuccess?.();
      toast.success(`${entityName} created`);
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Operation failed'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: TDeleteId; data: TUpdateData }) => updateFn(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setEditingId(null);
      onUpdateSuccess?.();
      toast.success(`${entityName} updated`);
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Operation failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: TDeleteId) => deleteFn(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success(`${entityName} deleted`);
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Operation failed'),
  });

  const confirmDelete = useCallback(() => {
    if (deleteTarget != null) {
      deleteMutation.mutate(deleteTarget);
    }
    setDeleteTarget(null);
  }, [deleteTarget, deleteMutation]);

  return {
    showAddForm,
    setShowAddForm,
    editingId,
    setEditingId,
    deleteTarget,
    setDeleteTarget,
    resetForm,
    createMutation,
    updateMutation,
    deleteMutation,
    confirmDelete,
  };
}
