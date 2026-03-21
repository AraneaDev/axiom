import { AlertTriangle, Trash2 } from 'lucide-react';

import { Button } from './Button';
import { Modal, ModalFooter } from './Modal';
import { Spinner } from './Spinner';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void> | null;
  title?: string;
  description?: string;
  confirmLabel?: string;
  variant?: 'danger' | 'warning';
  loading?: boolean;
}

const icons = {
  danger: Trash2,
  warning: AlertTriangle,
};

/**
 * Reusable confirmation dialog for destructive or important actions.
 * Wraps the shared Modal with a consistent confirm/cancel layout.
 * @param root0
 * @param root0.open
 * @param root0.onClose
 * @param root0.onConfirm
 * @param root0.title
 * @param root0.description
 * @param root0.confirmLabel
 * @param root0.variant
 * @param root0.loading
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  description = 'This action cannot be undone.',
  confirmLabel = 'Delete',
  variant = 'danger',
  loading = false,
}: ConfirmDialogProps) {
  const Icon = icons[variant];

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5 p-2 rounded-lg bg-danger-light">
          <Icon className="h-4 w-4 text-danger" />
        </div>
        <p className="text-sm text-text-secondary">{description}</p>
      </div>
      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
          <AlertTriangle className="h-3.5 w-3.5 opacity-0" />
          Cancel
        </Button>
        <Button variant="danger" size="sm" onClick={onConfirm} disabled={loading}>
          {loading ? <Spinner className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
