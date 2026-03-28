import { Plus } from 'lucide-react';

import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { FormModal } from '@/components/ui/FormModal';
import { Input } from '@/components/ui/Input';

interface SprintFormData {
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
}

interface SprintFormModalProps {
  open: boolean;
  onClose: () => void;
  sprint: SprintFormData;
  onSprintChange: (sprint: SprintFormData) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  projectId?: string;
}

/**
 *
 * @param root0
 * @param root0.open
 * @param root0.onClose
 * @param root0.sprint
 * @param root0.onSprintChange
 * @param root0.onSubmit
 * @param root0.isSubmitting
 * @param root0.projectId
 */
export function SprintFormModal({
  open,
  onClose,
  sprint,
  onSprintChange,
  onSubmit,
  isSubmitting,
  projectId,
}: SprintFormModalProps) {
  return (
    <FormModal
      open={open}
      onClose={onClose}
      title="Create Sprint"
      onSubmit={onSubmit}
      isPending={isSubmitting}
      submitLabel="Create Sprint"
      submitIcon={<Plus className="h-4 w-4" />}
      disabled={!sprint.name || !sprint.startDate || !sprint.endDate}
    >
      <Input
        label="Sprint Name"
        value={sprint.name}
        onChange={(e) => onSprintChange({ ...sprint, name: e.target.value })}
        placeholder="Sprint 1"
      />
      <div>
        <label className="block text-sm font-medium text-text mb-1">Sprint Goal (optional)</label>
        <MarkdownEditor
          compact
          value={sprint.goal}
          onChange={(val) => onSprintChange({ ...sprint, goal: val })}
          placeholder="What do you want to achieve in this sprint?"
          projectId={projectId}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Start Date"
          type="date"
          value={sprint.startDate}
          onChange={(e) => onSprintChange({ ...sprint, startDate: e.target.value })}
        />
        <Input
          label="End Date"
          type="date"
          value={sprint.endDate}
          onChange={(e) => onSprintChange({ ...sprint, endDate: e.target.value })}
        />
      </div>
    </FormModal>
  );
}
