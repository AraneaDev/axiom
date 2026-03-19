import { X } from 'lucide-react';
import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

const sizes = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

/**
 * Accessible overlay dialog rendered via createPortal.
 * Manages focus trapping, Escape key dismissal, and scroll locking.
 * @param props - Modal configuration.
 * @param props.open - Whether the modal is visible.
 * @param props.onClose - Callback fired when the modal should close (backdrop click or Escape).
 * @param props.title - Optional header title; also used as aria-label.
 * @param props.size - Width constraint: sm, md, lg. Defaults to md.
 * @param props.children - Modal body content.
 */
export function Modal({ open, onClose, title, size = 'md', children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => !el.hasAttribute('disabled'));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    window.addEventListener('keydown', handleKeyDown);

    // Set initial focus on first focusable element
    requestAnimationFrame(() => {
      if (dialogRef.current) {
        const first = dialogRef.current.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        first?.focus();
      }
    });

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open, handleKeyDown]);

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      {/* Content */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative bg-surface-elevated border border-border rounded-xl shadow-xl w-full animate-scale-in max-h-[calc(100vh-4rem)] overflow-y-auto',
          sizes[size],
        )}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
            <h2 className="text-sm font-semibold text-text">{title}</h2>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-text-tertiary hover:text-text hover:bg-surface-tertiary transition-colors"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Footer section for Modal dialogs with right-aligned action buttons.
 * @param props - Footer props.
 * @param props.children - Typically Button components for confirm/cancel actions.
 */
export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-border-light">
      {children}
    </div>
  );
}
