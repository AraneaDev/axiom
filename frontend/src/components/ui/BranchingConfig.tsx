import type { FormField } from '@/api/forms.api';
import { cn } from '@/lib/utils';

interface BranchingConfigProps {
  availableFields: FormField[];
  conditionFieldId: string | null;
  conditionOperator: string | null;
  conditionValue: string | null;
  onChange: (data: {
    conditionFieldId: string | null;
    conditionOperator: string | null;
    conditionValue: string | null;
  }) => void;
  className?: string;
}

const OPERATORS = [
  { value: 'EQUALS', label: 'Equals' },
  { value: 'NOT_EQUALS', label: 'Not equals' },
  { value: 'CONTAINS', label: 'Contains' },
  { value: 'GT', label: 'Greater than' },
  { value: 'LT', label: 'Less than' },
];

const inputClass =
  'h-8 px-2.5 text-[13px] bg-surface border border-border rounded-md focus:outline-none focus:border-primary text-text w-full';

/**
 * Page branching condition editor. Lets users configure when a page should be shown
 * based on the value of a field from an earlier page.
 * @param root0
 * @param root0.availableFields
 * @param root0.conditionFieldId
 * @param root0.conditionOperator
 * @param root0.conditionValue
 * @param root0.onChange
 * @param root0.className
 */
export function BranchingConfig({
  availableFields,
  conditionFieldId,
  conditionOperator,
  conditionValue,
  onChange,
  className,
}: BranchingConfigProps) {
  function handleFieldChange(fieldId: string) {
    if (fieldId === '') {
      onChange({ conditionFieldId: null, conditionOperator: null, conditionValue: null });
    } else {
      onChange({
        conditionFieldId: fieldId,
        conditionOperator: conditionOperator ?? 'EQUALS',
        conditionValue: conditionValue ?? '',
      });
    }
  }

  function handleOperatorChange(operator: string) {
    onChange({ conditionFieldId, conditionOperator: operator, conditionValue });
  }

  function handleValueChange(value: string) {
    onChange({ conditionFieldId, conditionOperator, conditionValue: value });
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <span>Show this page when</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={conditionFieldId ?? ''}
          onChange={(e) => handleFieldChange(e.target.value)}
          className={cn(inputClass, 'flex-1 min-w-[140px]')}
        >
          <option value="">Always show</option>
          {availableFields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>

        {conditionFieldId && (
          <>
            <select
              value={conditionOperator ?? 'EQUALS'}
              onChange={(e) => handleOperatorChange(e.target.value)}
              className={cn(inputClass, 'w-36')}
            >
              {OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={conditionValue ?? ''}
              onChange={(e) => handleValueChange(e.target.value)}
              placeholder="Value"
              className={cn(inputClass, 'flex-1 min-w-[100px]')}
            />
          </>
        )}
      </div>
    </div>
  );
}
