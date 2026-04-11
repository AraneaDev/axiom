import { Bookmark, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';

interface IssueListSaveFilterModalProps {
  open: boolean;
  onClose: () => void;
  filterName: string;
  onFilterNameChange: (name: string) => void;
  onSave: () => void;
  isSaving: boolean;
}

/**
 *
 * @param root0
 * @param root0.open
 * @param root0.onClose
 * @param root0.filterName
 * @param root0.onFilterNameChange
 * @param root0.onSave
 * @param root0.isSaving
 */
export function IssueListSaveFilterModal({
  open,
  onClose,
  filterName,
  onFilterNameChange,
  onSave,
  isSaving,
}: IssueListSaveFilterModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Save Filter" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!filterName.trim()) return;
          onSave();
        }}
      >
        <Input
          label="Filter name"
          placeholder="e.g. My urgent bugs"
          value={filterName}
          onChange={(e) => onFilterNameChange(e.target.value)}
          autoFocus
        />
        <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-border-light">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
          <Button size="sm" type="submit" disabled={!filterName.trim() || isSaving}>
            <Bookmark className="h-3.5 w-3.5" /> Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
