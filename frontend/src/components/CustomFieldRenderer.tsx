import { Check, ChevronDown, Calendar, Hash, Type, User, List } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

import type { CustomFieldDefinition } from '@/api/custom-fields.api';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

interface CustomFieldRendererProps {
  definition: CustomFieldDefinition;
  value: string | undefined;
  onChange: (value: string) => void;
  teamMembers?: { user: { id: string; displayName: string } }[];
}

const TYPE_ICONS: Record<string, typeof Type> = {
  TEXT: Type,
  NUMBER: Hash,
  DATE: Calendar,
  SELECT: List,
  MULTI_SELECT: List,
  USER: User,
};

/**
 * Renders a custom field value editor based on the field type.
 * @param root0
 * @param root0.definition
 * @param root0.value
 * @param root0.onChange
 * @param root0.teamMembers
 */
export function CustomFieldRenderer({
  definition,
  value,
  onChange,
  teamMembers = [],
}: CustomFieldRendererProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const Icon = TYPE_ICONS[definition.type] ?? Type;

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  function save(newValue: string) {
    onChange(newValue);
    setEditing(false);
  }

  // TEXT
  if (definition.type === 'TEXT') {
    if (editing) {
      return (
        <Input
          ref={inputRef}
          id={`cf-text-${definition.id}`}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save(draft);
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={() => save(draft)}
        />
      );
    }
    return (
      <Button
        variant="ghost"
        size="xs"
        onClick={() => {
          setDraft(value ?? '');
          setEditing(true);
        }}
        className="hover:opacity-80 w-full justify-start"
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-sm truncate">
          {value || <span className="text-text-tertiary">Set value</span>}
        </span>
      </Button>
    );
  }

  // NUMBER
  if (definition.type === 'NUMBER') {
    if (editing) {
      return (
        <Input
          ref={inputRef}
          id={`cf-num-${definition.id}`}
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save(draft);
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={() => save(draft)}
        />
      );
    }
    return (
      <Button
        variant="ghost"
        size="xs"
        onClick={() => {
          setDraft(value ?? '');
          setEditing(true);
        }}
        className="hover:opacity-80 w-full justify-start"
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-sm">
          {value || <span className="text-text-tertiary">Set value</span>}
        </span>
      </Button>
    );
  }

  // DATE
  if (definition.type === 'DATE') {
    return (
      <div className="flex items-center gap-1">
        <Icon className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
        <Input
          id={`cf-date-${definition.id}`}
          type="date"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  // SELECT
  if (definition.type === 'SELECT') {
    const options = Array.isArray(definition.options) ? definition.options : [];
    if (editing) {
      return (
        <div className="space-y-0.5 max-h-40 overflow-y-auto">
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              save('');
            }}
            className={cn(
              'w-full justify-start',
              !value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-text-secondary hover:border-primary',
            )}
          >
            <Check className={cn('h-3 w-3', !value ? 'opacity-100' : 'opacity-0')} /> None
          </Button>
          {options.map((opt) => (
            <Button
              key={opt}
              variant="outline"
              size="xs"
              onClick={() => save(opt)}
              className={cn(
                'w-full justify-start',
                value === opt
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-text-secondary hover:border-primary',
              )}
            >
              <Check className={cn('h-3 w-3', value === opt ? 'opacity-100' : 'opacity-0')} /> {opt}
            </Button>
          ))}
        </div>
      );
    }
    return (
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setEditing(true)}
        className="hover:opacity-80 w-full justify-start"
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-sm flex-1 text-left truncate">
          {value || <span className="text-text-tertiary">Select</span>}
        </span>
        <ChevronDown className="h-3 w-3 text-text-tertiary" />
      </Button>
    );
  }

  // MULTI_SELECT
  if (definition.type === 'MULTI_SELECT') {
    const options = Array.isArray(definition.options) ? definition.options : [];
    const selected = value ? value.split(',').filter(Boolean) : [];
    if (editing) {
      return (
        <div className="space-y-0.5 max-h-40 overflow-y-auto">
          {options.map((opt) => {
            const isSelected = selected.includes(opt);
            return (
              <Button
                key={opt}
                variant="outline"
                size="xs"
                onClick={() => {
                  const next = isSelected ? selected.filter((s) => s !== opt) : [...selected, opt];
                  onChange(next.join(','));
                }}
                className={cn(
                  'w-full justify-start',
                  isSelected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-text-secondary hover:border-primary',
                )}
              >
                <Check className={cn('h-3 w-3', isSelected ? 'opacity-100' : 'opacity-0')} /> {opt}
              </Button>
            );
          })}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setEditing(false)}
            className="text-text-tertiary"
          >
            <Check className="h-3 w-3" /> Done
          </Button>
        </div>
      );
    }
    return (
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setEditing(true)}
        className="hover:opacity-80 w-full justify-start"
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-sm flex-1 text-left truncate">
          {selected.length > 0 ? (
            selected.join(', ')
          ) : (
            <span className="text-text-tertiary">Select</span>
          )}
        </span>
        <ChevronDown className="h-3 w-3 text-text-tertiary" />
      </Button>
    );
  }

  // USER
  if (definition.type === 'USER') {
    if (editing) {
      return (
        <div className="space-y-0.5 max-h-40 overflow-y-auto">
          <Button
            variant="outline"
            size="xs"
            onClick={() => save('')}
            className={cn(
              'w-full justify-start',
              !value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-text-secondary hover:border-primary',
            )}
          >
            <User className="h-3 w-3" /> None
          </Button>
          {teamMembers.map((m) => (
            <Button
              key={m.user.id}
              variant="outline"
              size="xs"
              onClick={() => save(m.user.id)}
              className={cn(
                'w-full justify-start',
                value === m.user.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-text-secondary hover:border-primary',
              )}
            >
              <Avatar name={m.user.displayName} size="sm" />
              {m.user.displayName}
            </Button>
          ))}
        </div>
      );
    }
    const selectedMember = teamMembers.find((m) => m.user.id === value);
    return (
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setEditing(true)}
        className="hover:opacity-80 w-full justify-start"
      >
        {selectedMember ? (
          <>
            <Avatar name={selectedMember.user.displayName} size="sm" />
            <span className="text-sm">{selectedMember.user.displayName}</span>
          </>
        ) : (
          <>
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="text-sm text-text-tertiary">Select user</span>
          </>
        )}
      </Button>
    );
  }

  return null;
}
