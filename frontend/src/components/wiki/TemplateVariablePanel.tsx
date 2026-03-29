import { User, Users, Calendar, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

const VARIABLE_GROUPS = [
  {
    label: 'User',
    icon: User,
    variables: [
      { name: '{{currentUser.displayName}}', description: 'Your display name' },
      { name: '{{currentUser.username}}', description: 'Your username' },
      { name: '{{currentUser.email}}', description: 'Your email' },
    ],
  },
  {
    label: 'Team & Space',
    icon: Users,
    variables: [
      { name: '{{team.name}}', description: 'Team name' },
      { name: '{{space.name}}', description: 'Wiki space name' },
      { name: '{{project.name}}', description: 'Project name' },
    ],
  },
  {
    label: 'Date & Time',
    icon: Calendar,
    variables: [{ name: '{{now()}}', description: 'Current date and time' }],
  },
];

interface TemplateVariablePanelProps {
  onInsert: (variable: string) => void;
}

/**
 *
 * @param root0
 * @param root0.onInsert
 */
export function TemplateVariablePanel({ onInsert }: TemplateVariablePanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    User: true,
    'Team & Space': true,
    'Date & Time': true,
  });

  return (
    <div className="w-64 border-l border-[var(--color-border)] p-3 space-y-3">
      <h3 className="text-sm font-medium text-[var(--color-text-primary)]">Template Variables</h3>
      {VARIABLE_GROUPS.map((group) => {
        const Icon = group.icon;
        const isExpanded = expanded[group.label] ?? true;
        return (
          <div key={group.label}>
            <button
              onClick={() => setExpanded((e) => ({ ...e, [group.label]: !isExpanded }))}
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] w-full"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <Icon className="h-3.5 w-3.5" />
              {group.label}
            </button>
            {isExpanded && (
              <div className="mt-1 space-y-1 pl-5">
                {group.variables.map((v) => (
                  <button
                    key={v.name}
                    onClick={() => onInsert(v.name)}
                    className="block w-full text-left text-xs hover:bg-[var(--color-bg-hover)] rounded px-1.5 py-1"
                    title={v.description}
                  >
                    <code className="text-[var(--color-primary)]">{v.name}</code>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
