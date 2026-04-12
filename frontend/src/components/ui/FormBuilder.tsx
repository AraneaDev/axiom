import { Eye, Plus, Send } from 'lucide-react';

import { Button } from './Button';
import { FormPageEditor } from './FormPageEditor';

import type { Form, FormField, FormPage } from '@/api/forms.api';
import { cn } from '@/lib/utils';

interface FormBuilderProps {
  form: Form;
  onUpdatePage: (pageId: string, data: Partial<FormPage>) => void;
  onDeletePage: (pageId: string) => void;
  onAddPage: () => void;
  onAddField: (pageId: string) => void;
  onUpdateField: (pageId: string, fieldId: string, data: Partial<FormField>) => void;
  onDeleteField: (pageId: string, fieldId: string) => void;
  onPreview: () => void;
  onPublish: () => void;
  className?: string;
}

/**
 * Container component for the form builder. Renders a toolbar with preview/publish
 * buttons, a list of page editors, and an add page button.
 * Publish is disabled when no field is mapped to the "title" issue field.
 * @param root0
 * @param root0.form
 * @param root0.onUpdatePage
 * @param root0.onDeletePage
 * @param root0.onAddPage
 * @param root0.onAddField
 * @param root0.onUpdateField
 * @param root0.onDeleteField
 * @param root0.onPreview
 * @param root0.onPublish
 * @param root0.className
 */
export function FormBuilder({
  form,
  onUpdatePage,
  onDeletePage,
  onAddPage,
  onAddField,
  onUpdateField,
  onDeleteField,
  onPreview,
  onPublish,
  className,
}: FormBuilderProps) {
  const allFields = form.pages.flatMap((p) => p.fields);
  const hasTitleMapping = allFields.some((f) => f.issueFieldMapping === 'title');

  const sortedPages = form.pages.slice().sort((a, b) => a.position - b.position);

  /**
   * For a given page index, return all fields from pages before it
   * to use as available branching condition fields.
   * @param pageIndex
   */
  function getAvailableFieldsForPage(pageIndex: number): FormField[] {
    return sortedPages
      .slice(0, pageIndex)
      .flatMap((p) => p.fields)
      .filter((f) => !['HEADING', 'DESCRIPTION'].includes(f.type));
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-semibold text-text truncate">{form.name}</h2>
          <p className="text-[12px] text-text-muted">
            {form.pages.length} {form.pages.length === 1 ? 'page' : 'pages'} &middot;{' '}
            {allFields.length} {allFields.length === 1 ? 'field' : 'fields'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onPreview}>
            <Eye size={14} />
            Preview
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onPublish}
            disabled={!hasTitleMapping}
            title={
              !hasTitleMapping
                ? 'Map at least one field to the issue title before publishing'
                : form.status === 'PUBLISHED'
                  ? 'Unpublish form'
                  : 'Publish form'
            }
          >
            <Send size={14} />
            {form.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
          </Button>
        </div>
      </div>

      {!hasTitleMapping && allFields.length > 0 && (
        <div className="text-[12px] text-warning bg-warning-light border border-warning/20 rounded-md px-3 py-2">
          Map at least one field to the issue title to enable publishing.
        </div>
      )}

      {/* Pages */}
      <div className="space-y-4">
        {sortedPages.map((page, index) => (
          <FormPageEditor
            key={page.id}
            page={page}
            pageIndex={index}
            availableFieldsForCondition={getAvailableFieldsForPage(index)}
            onUpdatePage={onUpdatePage}
            onDeletePage={onDeletePage}
            onAddField={onAddField}
            onUpdateField={onUpdateField}
            onDeleteField={onDeleteField}
          />
        ))}

        {form.pages.length === 0 && (
          <div className="text-center py-12 text-text-muted text-[13px] border border-dashed border-border rounded-lg">
            No pages yet. Add a page to start building your form.
          </div>
        )}
      </div>

      {/* Add page */}
      <Button variant="outline" size="sm" onClick={onAddPage} className="w-full">
        <Plus size={14} />
        Add page
      </Button>
    </div>
  );
}
