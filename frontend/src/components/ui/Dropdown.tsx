import { useState, useRef, useEffect, forwardRef, type ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
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

export function Dropdown({ trigger, children, align = 'left', className }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className={cn('relative inline-block', className)}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          className={cn(
            'absolute z-40 mt-1 min-w-[10rem] rounded-lg border border-border bg-surface-elevated shadow-lg py-1 animate-fade-in',
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

export function DropdownItem({ children, onClick, danger, disabled, className }: DropdownItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors',
        danger
          ? 'text-danger hover:bg-danger/10'
          : 'text-text hover:bg-surface-tertiary',
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

export const Select = forwardRef<HTMLDivElement, SelectProps>(
  ({ label, error, hint, id, options, value, onChange, multiple, placeholder = 'Select...', disabled, className }, ref) => {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!open) return;
      const handler = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
      };
      window.addEventListener('mousedown', handler);
      return () => window.removeEventListener('mousedown', handler);
    }, [open]);

    const selected = multiple
      ? Array.isArray(value) ? value : []
      : typeof value === 'string' ? value : '';

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

    const displayLabel = multiple
      ? null
      : options.find((o) => o.value === selected)?.label;

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
              'focus:border-border-focus focus:ring-2 focus:ring-primary/15 focus:outline-none',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              error ? 'border-danger focus:border-danger focus:ring-danger/15' : 'border-border',
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
            <ChevronDown className={cn('h-4 w-4 text-text-tertiary transition-transform', open && 'rotate-180')} />
          </button>

          {open && (
            <div className="absolute z-40 mt-1 w-full rounded-lg border border-border bg-surface-elevated shadow-lg py-1 max-h-60 overflow-y-auto animate-fade-in">
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
