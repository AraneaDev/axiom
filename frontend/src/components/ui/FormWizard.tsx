import { ArrowLeft, ArrowRight, Send } from 'lucide-react';
import { useState } from 'react';

import { Button } from './Button';
import { WizardProgress } from './WizardProgress';

import type { Form, FormField, FormPage } from '@/api/forms.api';
import { cn } from '@/lib/utils';

interface FormWizardProps {
  form: Form;
  onSubmit: (data: { responses: Record<string, unknown>; honeypot: string }) => void;
  isSubmitting: boolean;
}

/**
 * Evaluate whether a page's display condition is satisfied given the current form data.
 * @param page
 * @param formData
 */
function evaluateCondition(page: FormPage, formData: Record<string, unknown>): boolean {
  if (!page.conditionFieldId || !page.conditionOperator) return true;

  const fieldValue = formData[page.conditionFieldId];
  const conditionValue = page.conditionValue ?? '';

  const strVal = fieldValue !== undefined && fieldValue !== null ? String(fieldValue) : '';

  switch (page.conditionOperator) {
    case 'EQUALS':
      return strVal === conditionValue;
    case 'NOT_EQUALS':
      return strVal !== conditionValue;
    case 'CONTAINS':
      return strVal.toLowerCase().includes(conditionValue.toLowerCase());
    case 'GT':
      return parseFloat(strVal) > parseFloat(conditionValue);
    case 'LT':
      return parseFloat(strVal) < parseFloat(conditionValue);
    default:
      return true;
  }
}

function renderField(
  field: FormField,
  value: unknown,
  onChange: (fieldId: string, val: unknown) => void,
) {
  const inputClass =
    'w-full px-3 py-2 text-[14px] bg-surface border border-border rounded-md focus:outline-none focus:border-primary text-text placeholder:text-text-muted';

  switch (field.type) {
    case 'HEADING':
      return (
        <h3 key={field.id} className="text-lg font-semibold text-text">
          {field.label}
        </h3>
      );

    case 'DESCRIPTION':
      return (
        <p key={field.id} className="text-[14px] text-text-secondary">
          {field.label}
        </p>
      );

    case 'TEXTAREA':
      return (
        <div key={field.id} className="space-y-1.5">
          <FieldLabel field={field} />
          <textarea
            value={(value as string) ?? ''}
            onChange={(e) => onChange(field.id, e.target.value)}
            placeholder={field.placeholder ?? undefined}
            rows={4}
            required={field.required}
            className={cn(inputClass, 'resize-y')}
          />
          <FieldHelp field={field} />
        </div>
      );

    case 'SELECT': {
      const opts = (field.options as { label: string; value: string }[] | null | undefined) ?? [];
      return (
        <div key={field.id} className="space-y-1.5">
          <FieldLabel field={field} />
          <select
            value={(value as string) ?? ''}
            onChange={(e) => onChange(field.id, e.target.value)}
            required={field.required}
            className={inputClass}
          >
            <option value="">Select an option</option>
            {opts.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <FieldHelp field={field} />
        </div>
      );
    }

    case 'RADIO': {
      const opts = (field.options as { label: string; value: string }[] | null | undefined) ?? [];
      return (
        <div key={field.id} className="space-y-1.5">
          <FieldLabel field={field} />
          <div className="space-y-2">
            {opts.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={field.id}
                  value={opt.value}
                  checked={value === opt.value}
                  onChange={() => onChange(field.id, opt.value)}
                  required={field.required}
                  className="text-primary focus:ring-primary/30"
                />
                <span className="text-[14px] text-text">{opt.label}</span>
              </label>
            ))}
          </div>
          <FieldHelp field={field} />
        </div>
      );
    }

    case 'MULTISELECT': {
      const opts = (field.options as { label: string; value: string }[] | null | undefined) ?? [];
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div key={field.id} className="space-y-1.5">
          <FieldLabel field={field} />
          <div className="space-y-2">
            {opts.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  value={opt.value}
                  checked={selected.includes(opt.value)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, opt.value]
                      : selected.filter((v) => v !== opt.value);
                    onChange(field.id, next);
                  }}
                  className="rounded border-border text-primary focus:ring-primary/30"
                />
                <span className="text-[14px] text-text">{opt.label}</span>
              </label>
            ))}
          </div>
          <FieldHelp field={field} />
        </div>
      );
    }

    case 'CHECKBOX':
      return (
        <div key={field.id} className="space-y-1.5">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => onChange(field.id, e.target.checked)}
              required={field.required}
              className="mt-0.5 rounded border-border text-primary focus:ring-primary/30"
            />
            <span className="text-[14px] text-text">
              {field.label}
              {field.required && <span className="text-danger ml-0.5">*</span>}
            </span>
          </label>
          <FieldHelp field={field} />
        </div>
      );

    case 'DATE':
      return (
        <div key={field.id} className="space-y-1.5">
          <FieldLabel field={field} />
          <input
            type="date"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(field.id, e.target.value)}
            required={field.required}
            className={inputClass}
          />
          <FieldHelp field={field} />
        </div>
      );

    default:
      return (
        <div key={field.id} className="space-y-1.5">
          <FieldLabel field={field} />
          <input
            type="text"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(field.id, e.target.value)}
            placeholder={field.placeholder ?? undefined}
            required={field.required}
            className={inputClass}
          />
          <FieldHelp field={field} />
        </div>
      );
  }
}

function FieldLabel({ field }: { field: FormField }) {
  return (
    <label className="block text-[13px] font-medium text-text">
      {field.label}
      {field.required && <span className="text-danger ml-0.5">*</span>}
    </label>
  );
}

function FieldHelp({ field }: { field: FormField }) {
  if (!field.helpText) return null;
  return <p className="text-[12px] text-text-muted">{field.helpText}</p>;
}

/**
 * Multi-step form wizard renderer. Manages form data state, evaluates page branching
 * conditions client-side, and renders fields by type with Back/Next/Submit navigation.
 * @param root0
 * @param root0.form
 * @param root0.onSubmit
 * @param root0.isSubmitting
 */
export function FormWizard({ form, onSubmit, isSubmitting }: FormWizardProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [honeypot, setHoneypot] = useState('');
  const [currentStep, setCurrentStep] = useState(0);

  const sortedPages = form.pages.slice().sort((a, b) => a.position - b.position);

  // Filter to only pages whose conditions are satisfied
  const visiblePages = sortedPages.filter((page) => evaluateCondition(page, formData));

  const currentPage = visiblePages[currentStep];
  const isLastStep = currentStep === visiblePages.length - 1;
  const isFirstStep = currentStep === 0;

  function handleFieldChange(fieldId: string, val: unknown) {
    setFormData((prev) => ({ ...prev, [fieldId]: val }));
  }

  function handleNext(e: React.FormEvent) {
    e.preventDefault();
    if (!isLastStep) {
      setCurrentStep((s) => s + 1);
    } else {
      onSubmit({ responses: formData, honeypot });
    }
  }

  function handleBack() {
    setCurrentStep((s) => Math.max(0, s - 1));
  }

  if (!currentPage) return null;

  const steps = visiblePages.map((p) => ({ title: p.title }));

  return (
    <div className="space-y-6">
      {visiblePages.length > 1 && <WizardProgress steps={steps} currentStep={currentStep} />}

      <form onSubmit={handleNext} className="space-y-5">
        {/* Page title */}
        {currentPage.title && (
          <h2 className="text-[17px] font-semibold text-text">{currentPage.title}</h2>
        )}

        {/* Fields */}
        {currentPage.fields
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((field) => renderField(field, formData[field.id], handleFieldChange))}

        {/* Honeypot — hidden from real users */}
        <div className="hidden" aria-hidden="true">
          <label htmlFor="__hp_field">Leave this blank</label>
          <input
            type="text"
            id="__hp_field"
            name="__hp_field"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
          />
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-2">
          <div>
            {!isFirstStep && (
              <Button type="button" variant="secondary" size="sm" onClick={handleBack}>
                <ArrowLeft size={14} />
                Back
              </Button>
            )}
          </div>
          <Button type="submit" variant="primary" size="sm" disabled={isSubmitting}>
            {isLastStep ? (
              <>
                <Send size={14} />
                {isSubmitting ? 'Submitting...' : 'Submit'}
              </>
            ) : (
              <>
                Next
                <ArrowRight size={14} />
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
