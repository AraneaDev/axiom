import { ChevronDown, X } from 'lucide-react';
import { useState, useRef, useEffect, useCallback, useId, forwardRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Dropdown (generic trigger + floating menu)                        */
/* ------------------------------------------------------------------ */

interface DropdownProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

/**
 * Generic dropdown menu with a custom trigger element.
 * Renders a floating panel that closes on outside click.
 * @param props - Dropdown configuration.
 * @param props.trigger - The element that toggles the menu on click.
 * @param props.children - Menu content, typically DropdownItem components.
 * @param props.align - Horizontal alignment of the panel: left or right. Defaults to left.
 * @param props.className - Additional CSS classes for the wrapper.
 */
export function Dropdown({ trigger, children, align = 'left', className }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const menuId = `dropdown-menu-${generatedId}`;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!open) return;
      const menu = menuRef.current;
      if (!menu) return;
      const items = Array.from(
        menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'),
      );
      if (items.length === 0) return;
      const focused = document.activeElement as HTMLElement;
      const idx = items.indexOf(focused);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[(idx + 1) % items.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1]?.focus();
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    },
    [open],
  );

  return (
    <div ref={ref} className={cn('relative inline-block', className)} onKeyDown={handleKeyDown}>
      <div
        className="cursor-pointer"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
      >
        {trigger}
      </div>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          className={cn(
            'absolute z-40 mt-1 min-w-[10rem] rounded-lg border border-border bg-surface-elevated shadow-lg py-1 animate-slide-down',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

interface DropdownItemProps {
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Individual menu item within a Dropdown.
 * Supports danger styling and disabled state.
 * @param props - Item configuration.
 * @param props.children - Item content (text and optional icon).
 * @param props.onClick - Click handler for the item action.
 * @param props.danger - Applies danger/destructive styling when true.
 * @param props.disabled - Disables the item interaction when true.
 * @param props.className
 */
export function DropdownItem({
  children,
  onClick,
  danger,
  disabled,
  className,
}: DropdownItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors',
        danger ? 'text-danger hover:bg-danger/10' : 'text-text hover:bg-surface-tertiary',
        disabled && 'opacity-40 cursor-not-allowed pointer-events-none',
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Select (form field matching Input.tsx API)                        */
/* ------------------------------------------------------------------ */

interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  error?: string;
  hint?: string;
  id?: string;
  options: Option[];
  value?: string | string[];
  onChange?: (value: string | string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Form select component matching the Input API pattern.
 * Supports single and multi-select modes with chip display for multi-select.
 * @param props - Select configuration.
 * @param props.label - Optional label displayed above the select.
 * @param props.error - Error message; applies danger styling.
 * @param props.hint - Hint text displayed when no error is present.
 * @param props.options - Array of value/label pairs to choose from.
 * @param props.value - Current selection (string for single, string[] for multi).
 * @param props.onChange - Callback with the new selection value.
 * @param props.multiple - Enables multi-select mode with removable chips.
 * @param props.placeholder - Placeholder text when no selection is made. Defaults to "Select...".
 * @param props.disabled - Disables the select when true.
 */
export const Select = forwardRef<HTMLDivElement, SelectProps>(
  (
    {
      label,
      error,
      hint,
      id,
      options,
      value,
      onChange,
      multiple,
      placeholder = 'Select...',
      disabled,
      className,
    },
    ref,
  ) => {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!open) return;
      const handler = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node))
          setOpen(false);
      };
      window.addEventListener('mousedown', handler);
      return () => window.removeEventListener('mousedown', handler);
    }, [open]);

    const selected = multiple
      ? Array.isArray(value)
        ? value
        : []
      : typeof value === 'string'
        ? value
        : '';

    const handleSelect = (optionValue: string) => {
      if (!onChange) return;
      if (multiple) {
        const arr = Array.isArray(selected) ? selected : [];
        const next = arr.includes(optionValue)
          ? arr.filter((v) => v !== optionValue)
          : [...arr, optionValue];
        onChange(next);
      } else {
        onChange(optionValue);
        setOpen(false);
      }
    };

    const removeChip = (optionValue: string) => {
      if (!onChange || !multiple) return;
      const arr = Array.isArray(selected) ? selected : [];
      onChange(arr.filter((v) => v !== optionValue));
    };

    const displayLabel = multiple ? null : options.find((o) => o.value === selected)?.label;

    return (
      <div ref={ref} className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={id} className="text-sm font-medium text-text">
            {label}
          </label>
        )}
        <div ref={containerRef} className="relative">
          <button
            type="button"
            id={id}
            disabled={disabled}
            onClick={() => setOpen((o) => !o)}
            className={cn(
              'flex w-full items-center justify-between rounded-md border bg-surface px-3 py-2 text-sm transition-all duration-150',
              'focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:outline-none',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              error
                ? 'border-danger focus-visible:border-danger focus-visible:ring-danger/30'
                : 'border-border',
              className,
            )}
          >
            {multiple ? (
              <div className="flex flex-wrap gap-1 flex-1">
                {Array.isArray(selected) && selected.length > 0 ? (
                  selected.map((v) => {
                    const opt = options.find((o) => o.value === v);
                    return (
                      <span
                        key={v}
                        className="inline-flex items-center gap-1 rounded bg-primary-light px-1.5 py-0.5 text-xs font-medium text-primary"
                      >
                        {opt?.label ?? v}
                        <X
                          className="h-3 w-3 cursor-pointer hover:text-danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeChip(v);
                          }}
                        />
                      </span>
                    );
                  })
                ) : (
                  <span className="text-text-tertiary">{placeholder}</span>
                )}
              </div>
            ) : (
              <span className={displayLabel ? 'text-text' : 'text-text-tertiary'}>
                {displayLabel ?? placeholder}
              </span>
            )}
            <ChevronDown
              className={cn(
                'h-4 w-4 text-text-tertiary transition-transform',
                open && 'rotate-180',
              )}
            />
          </button>

          {open && (
            <div className="absolute z-40 mt-1 w-full rounded-lg border border-border bg-surface-elevated shadow-lg py-1 max-h-60 overflow-y-auto animate-slide-down">
              {options.map((opt) => {
                const isSelected = multiple
                  ? Array.isArray(selected) && selected.includes(opt.value)
                  : selected === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={cn(
                      'flex w-full items-center px-3 py-1.5 text-sm transition-colors',
                      isSelected
                        ? 'bg-primary-light text-primary font-medium'
                        : 'text-text hover:bg-surface-tertiary',
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        {hint && !error && <p className="text-xs text-text-tertiary">{hint}</p>}
      </div>
    );
  },
);
Select.displayName = 'Select';
