import { Plus, Trash2 } from 'lucide-react';

import type { FormField, FormPage } from '@/api/forms.api';
import { cn } from '@/lib/utils';

import { BranchingConfig } from './BranchingConfig';
import { Button } from './Button';
import { FormFieldEditor } from './FormFieldEditor';

interface FormPageEditorProps {
  page: FormPage;
  pageIndex: number;
  availableFieldsForCondition: FormField[];
  onUpdatePage: (pageId: string, data: Partial<FormPage>) => void;
  onDeletePage: (pageId: string) => void;
  onAddField: (pageId: string) => void;
  onUpdateField: (pageId: string, fieldId: string, data: Partial<FormField>) => void;
  onDeleteField: (pageId: string, fieldId: string) => void;
  className?: string;
}

const inputClass =
  'w-full h-8 px-2.5 text-[13px] bg-surface border border-border rounded-md focus:outline-none focus:border-primary text-text placeholder:text-text-muted';

/**
 * Editor panel for a single form page. Shows page title, optional branching config
 * (for pages after the first), a list of field editors, and add/delete controls.
 * @param root0
 * @param root0.page
 * @param root0.pageIndex
 * @param root0.availableFieldsForCondition
 * @param root0.onUpdatePage
 * @param root0.onDeletePage
 * @param root0.onAddField
 * @param root0.onUpdateField
 * @param root0.onDeleteField
 * @param root0.className
 */
export function FormPageEditor({
  page,
  pageIndex,
  availableFieldsForCondition,
  onUpdatePage,
  onDeletePage,
  onAddField,
  onUpdateField,
  onDeleteField,
  className,
}: FormPageEditorProps) {
  return (
    <div className={cn('border border-border rounded-lg bg-surface-secondary', className)}>
      {/* Page header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider shrink-0">
          Page {pageIndex + 1}
        </span>
        <input
          type="text"
          value={page.title}
          onChange={(e) => onUpdatePage(page.id, { title: e.target.value })}
          placeholder="Page title"
          className={cn(inputClass, 'flex-1')}
        />
        <Button
          variant="ghost"
          size="xs"
          title="Delete page"
          aria-label="Delete page"
          onClick={() => onDeletePage(page.id)}
          className="text-text-muted hover:text-danger shrink-0"
        >
          <Trash2 size={14} />
        </Button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Branching config — only for pages after the first */}
        {pageIndex > 0 && (
          <div className="p-3 bg-surface rounded-md border border-border">
            <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">
              Display condition
            </div>
            <BranchingConfig
              availableFields={availableFieldsForCondition}
              conditionFieldId={page.conditionFieldId ?? null}
              conditionOperator={page.conditionOperator ?? null}
              conditionValue={page.conditionValue ?? null}
              onChange={(data) => onUpdatePage(page.id, data)}
            />
          </div>
        )}

        {/* Fields */}
        <div className="space-y-2">
          {page.fields
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((field) => (
              <FormFieldEditor
                key={field.id}
                field={field}
                onUpdate={(fieldId, data) => onUpdateField(page.id, fieldId, data)}
                onDelete={(fieldId) => onDeleteField(page.id, fieldId)}
              />
            ))}

          {page.fields.length === 0 && (
            <p className="text-[13px] text-text-muted text-center py-4">
              No fields yet. Add a field below.
            </p>
          )}
        </div>

        {/* Add field */}
        <Button variant="outline" size="sm" onClick={() => onAddField(page.id)} className="w-full">
          <Plus size={14} />
          Add field
        </Button>
      </div>
    </div>
  );
}
