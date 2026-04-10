import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from './Button';
import { FieldOptionEditor, type FieldOption } from './FieldOptionEditor';

import type { FormField } from '@/api/forms.api';

interface FormFieldEditorProps {
  field: FormField;
  onUpdate: (fieldId: string, data: Partial<FormField>) => void;
  onDelete: (fieldId: string) => void;
}

const FIELD_TYPES = [
  { value: 'TEXT', label: 'Short text' },
  { value: 'TEXTAREA', label: 'Long text' },
  { value: 'SELECT', label: 'Dropdown' },
  { value: 'RADIO', label: 'Radio buttons' },
  { value: 'CHECKBOX', label: 'Checkbox' },
  { value: 'MULTISELECT', label: 'Multi-select' },
  { value: 'DATE', label: 'Date' },
  { value: 'HEADING', label: 'Heading' },
  { value: 'DESCRIPTION', label: 'Description' },
];

const ISSUE_FIELD_MAPPINGS = [
  { value: '', label: 'None' },
  { value: 'title', label: 'Issue title' },
  { value: 'body', label: 'Issue body' },
  { value: 'type', label: 'Issue type' },
  { value: 'priority', label: 'Priority' },
  { value: 'labels', label: 'Labels' },
];

const HAS_OPTIONS = ['SELECT', 'RADIO', 'MULTISELECT'];
const IS_CONTENT = ['HEADING', 'DESCRIPTION'];

const inputClass =
  'w-full h-8 px-2.5 text-[13px] bg-surface border border-border rounded-md focus:outline-none focus:border-primary text-text placeholder:text-text-muted';

/**
 * Expandable editor panel for a single form field. Configures type, label,
 * placeholder, help text, required flag, issue field mapping, and options.
 * @param root0
 * @param root0.field
 * @param root0.onUpdate
 * @param root0.onDelete
 */
export function FormFieldEditor({ field, onUpdate, onDelete }: FormFieldEditorProps) {
  const [expanded, setExpanded] = useState(false);

  function update(data: Partial<FormField>) {
    onUpdate(field.id, data);
  }

  const hasOptions = HAS_OPTIONS.includes(field.type);
  const isContent = IS_CONTENT.includes(field.type);

  return (
    <div className="border border-border rounded-md bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 flex-1 text-left min-w-0"
        >
          {expanded ? (
            <ChevronDown size={14} className="text-text-muted shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-text-muted shrink-0" />
          )}
          <span className="text-[13px] font-medium text-text truncate">
            {field.label || <span className="text-text-muted italic">Untitled field</span>}
          </span>
          <span className="ml-1 text-[11px] text-text-muted shrink-0">
            {FIELD_TYPES.find((t) => t.value === field.type)?.label ?? field.type}
          </span>
        </button>
        <Button
          variant="ghost"
          size="xs"
          title="Delete field"
          aria-label="Delete field"
          onClick={() => onDelete(field.id)}
          className="text-text-muted hover:text-danger shrink-0"
        >
          <Trash2 size={14} />
        </Button>
      </div>

      {/* Expanded config */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border">
          {/* Type */}
          <div className="pt-3 space-y-1">
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">
              Type
            </label>
            <select
              value={field.type}
              onChange={(e) => update({ type: e.target.value })}
              className={inputClass}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Label */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">
              {isContent ? 'Content' : 'Label'}
            </label>
            <input
              type="text"
              value={field.label}
              onChange={(e) => update({ label: e.target.value })}
              placeholder={isContent ? 'Enter text...' : 'Field label'}
              className={inputClass}
            />
          </div>

          {!isContent && (
            <>
              {/* Placeholder */}
              {field.type !== 'CHECKBOX' && (
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">
                    Placeholder
                  </label>
                  <input
                    type="text"
                    value={field.placeholder ?? ''}
                    onChange={(e) => update({ placeholder: e.target.value || null })}
                    placeholder="Placeholder text"
                    className={inputClass}
                  />
                </div>
              )}

              {/* Help text */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">
                  Help text
                </label>
                <input
                  type="text"
                  value={field.helpText ?? ''}
                  onChange={(e) => update({ helpText: e.target.value || null })}
                  placeholder="Optional description shown below the field"
                  className={inputClass}
                />
              </div>

              {/* Required */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => update({ required: e.target.checked })}
                  className="rounded border-border text-primary focus:ring-primary/30"
                />
                <span className="text-[13px] text-text">Required</span>
              </label>

              {/* Issue field mapping */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">
                  Map to issue field
                </label>
                <select
                  value={field.issueField ?? ''}
                  onChange={(e) => update({ issueField: e.target.value || null })}
                  className={inputClass}
                >
                  {ISSUE_FIELD_MAPPINGS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Options editor for select types */}
              {hasOptions && (
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">
                    Options
                  </label>
                  <FieldOptionEditor
                    options={(field.options as FieldOption[] | null | undefined) ?? []}
                    onChange={(opts) => update({ options: opts })}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
