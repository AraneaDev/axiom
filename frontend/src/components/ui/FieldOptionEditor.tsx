import { Plus, Trash2 } from 'lucide-react';

import { Button } from './Button';

import { cn } from '@/lib/utils';

export interface FieldOption {
  label: string;
  value: string;
}

interface FieldOptionEditorProps {
  options: FieldOption[];
  onChange: (options: FieldOption[]) => void;
  className?: string;
}

/**
 * List editor for select/radio/multiselect field options.
 * Each row has a label input and value input with auto-generation from label.
 * @param root0
 * @param root0.options
 * @param root0.onChange
 * @param root0.className
 */
export function FieldOptionEditor({ options, onChange, className }: FieldOptionEditorProps) {
  function handleLabelChange(index: number, label: string) {
    const updated = options.map((opt, i) => {
      if (i !== index) return opt;
      // Auto-generate value from label only if value is still derived from the old label
      const autoValue = opt.label
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
      const isAutoValue = opt.value === autoValue || opt.value === '';
      const newValue = isAutoValue
        ? label
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '')
        : opt.value;
      return { label, value: newValue };
    });
    onChange(updated);
  }

  function handleValueChange(index: number, value: string) {
    const updated = options.map((opt, i) => (i === index ? { ...opt, value } : opt));
    onChange(updated);
  }

  function handleDelete(index: number) {
    onChange(options.filter((_, i) => i !== index));
  }

  function handleAdd() {
    onChange([...options, { label: '', value: '' }]);
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={opt.label}
            onChange={(e) => handleLabelChange(i, e.target.value)}
            placeholder="Label"
            className="flex-1 h-8 px-2.5 text-[13px] bg-surface border border-border rounded-md focus:outline-none focus:border-primary text-text placeholder:text-text-muted"
          />
          <input
            type="text"
            value={opt.value}
            onChange={(e) => handleValueChange(i, e.target.value)}
            placeholder="Value"
            className="w-32 h-8 px-2.5 text-[13px] bg-surface border border-border rounded-md focus:outline-none focus:border-primary text-text placeholder:text-text-muted font-mono"
          />
          <Button
            variant="ghost"
            size="xs"
            title="Remove option"
            aria-label="Remove option"
            onClick={() => handleDelete(i)}
            className="text-text-muted hover:text-danger"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="xs" onClick={handleAdd} className="text-text-secondary">
        <Plus size={14} />
        Add option
      </Button>
    </div>
  );
}
