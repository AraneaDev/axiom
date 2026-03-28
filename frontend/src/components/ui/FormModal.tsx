import { X, Loader2 } from 'lucide-react';
import { type ReactNode } from 'react';

import { Button } from './Button';
import { Modal, ModalFooter } from './Modal';

interface FormModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  onSubmit: () => void;
  isPending: boolean;
  error?: string | null;
  submitLabel: string;
  submitIcon: ReactNode;
  cancelLabel?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

/**
 *
 * @param root0
 * @param root0.open
 * @param root0.onClose
 * @param root0.title
 * @param root0.onSubmit
 * @param root0.isPending
 * @param root0.error
 * @param root0.submitLabel
 * @param root0.submitIcon
 * @param root0.cancelLabel
 * @param root0.disabled
 * @param root0.size
 * @param root0.children
 */
export function FormModal({
  open,
  onClose,
  title,
  onSubmit,
  isPending,
  error,
  submitLabel,
  submitIcon,
  cancelLabel = 'Cancel',
  disabled = false,
  size,
  children,
}: FormModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} size={size}>
      <div className="space-y-4">
        {children}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          <X className="h-4 w-4" />
          {cancelLabel}
        </Button>
        <Button onClick={onSubmit} disabled={disabled || isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : submitIcon}
          {submitLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
