import { useQuery } from '@tanstack/react-query';
import { FolderPlus } from 'lucide-react';
import { useState } from 'react';

import { wikiApi } from '@/api/wiki.api';
import { Select } from '@/components/ui/Dropdown';
import { FormModal } from '@/components/ui/FormModal';
import { Input } from '@/components/ui/Input';
import { useFormError } from '@/hooks/useFormError';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import type { PageTreeNode } from '@/lib/types';

interface CreateFolderModalProps {
  open: boolean;
  onClose: () => void;
  spaceId: string;
  parentId?: string | null;
  onCreated: () => void;
}

function flattenTree(nodes: PageTreeNode[], depth = 0): { value: string; label: string }[] {
  const result: { value: string; label: string }[] = [];
  for (const node of nodes) {
    result.push({
      value: node.id,
      label: `${'--'.repeat(depth)}${depth > 0 ? ' ' : ''}${node.title}`,
    });
    if (node.children?.length) {
      result.push(...flattenTree(node.children, depth + 1));
    }
  }
  return result;
}

/**
 * Modal for creating a folder (a page with no body content).
 * @param props - CreateFolderModalProps
 * @param props.open - Whether the modal is visible.
 * @param props.onClose - Callback to close the modal.
 * @param props.spaceId - The wiki space to create the folder in.
 * @param props.parentId - Optional pre-selected parent page ID.
 * @param props.onCreated - Callback fired after successful creation.
 */
export function CreateFolderModal({
  open,
  onClose,
  spaceId,
  parentId: initialParentId,
  onCreated,
}: CreateFolderModalProps) {
  const [name, setName] = useState('');
  const [selectedParentId, setSelectedParentId] = useState<string>(initialParentId ?? '');
  const { error, setError, clearError } = useFormError();

  const { data: pageTree = [] } = useQuery({
    queryKey: ['wikiPageTree', spaceId],
    queryFn: () => wikiApi.getPageTree(spaceId),
    enabled: open && !!spaceId,
  });

  const parentName = initialParentId ? findNodeTitle(pageTree, initialParentId) : null;

  const parentOptions = [{ value: '', label: 'None (top level)' }, ...flattenTree(pageTree)];

  const createMutation = useMutationWithToast(
    () => {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      return wikiApi.createPage(spaceId, {
        title: name,
        slug,
        body: '',
        ...(selectedParentId ? { parentId: selectedParentId } : {}),
      });
    },
    {
      successMessage: 'Folder created',
      errorMessage: null,
      onSuccess: () => {
        setName('');
        setSelectedParentId(initialParentId ?? '');
        clearError();
        onCreated();
        onClose();
      },
      onError: (err) => {
        setError(err.message || 'Failed to create folder');
      },
    },
  );

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title="New Folder"
      onSubmit={() => createMutation.mutate()}
      isPending={createMutation.isPending}
      error={error}
      submitLabel="Create Folder"
      submitIcon={<FolderPlus className="h-4 w-4" />}
      disabled={!name.trim()}
    >
      <Input
        id="folder-name"
        label="Folder Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Folder name"
        required
      />

      {initialParentId && parentName ? (
        <p className="text-sm text-text-secondary">
          Creating in: <span className="font-medium text-text">{parentName}</span>
        </p>
      ) : (
        pageTree.length > 0 && (
          <Select
            label="Parent Page"
            id="folder-parent"
            value={selectedParentId}
            onChange={(v) => setSelectedParentId(v as string)}
            options={parentOptions}
            placeholder="None (top level)"
          />
        )
      )}
    </FormModal>
  );
}

/**
 * Recursively find a node title by ID in the page tree.
 * @param nodes
 * @param id
 */
function findNodeTitle(nodes: PageTreeNode[], id: string): string | null {
  for (const node of nodes) {
    if (node.id === id) return node.title;
    if (node.children?.length) {
      const found = findNodeTitle(node.children, id);
      if (found) return found;
    }
  }
  return null;
}
