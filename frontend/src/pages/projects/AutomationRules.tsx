import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bot,
  Plus,
  Trash2,
  Power,
  PowerOff,
  Save,
  X,
  PlusCircle,
  Zap,
} from 'lucide-react';
import { useState } from 'react';

import {
  automationApi,
  type AutomationCondition,
  type AutomationAction,
  type AutomationRule,
} from '@/api/workflows.api';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useProjectContext } from '@/hooks/useProjectContext';

const TRIGGER_OPTIONS = [
  { value: 'issue:created', label: 'Issue Created' },
  { value: 'issue:status_changed', label: 'Status Changed' },
  { value: 'issue:assigned', label: 'Issue Assigned' },
  { value: 'label:added', label: 'Label Added' },
];

const CONDITION_FIELDS = [
  { value: 'type', label: 'Issue Type' },
  { value: 'priority', label: 'Priority' },
  { value: 'title', label: 'Title' },
];

const CONDITION_OPERATORS = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'in', label: 'is one of' },
  { value: 'not_in', label: 'is not one of' },
  { value: 'contains', label: 'contains' },
];

const ACTION_TYPES = [
  { value: 'set_status', label: 'Set Status (Column)' },
  { value: 'set_assignee', label: 'Set Assignee' },
  { value: 'add_label', label: 'Add Label' },
  { value: 'add_comment', label: 'Add Comment' },
];

function emptyCondition(): AutomationCondition {
  return { field: 'type', operator: 'equals', value: '' };
}

function emptyAction(): AutomationAction {
  return { type: 'add_label', name: '' };
}

interface RuleFormData {
  name: string;
  trigger: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
}

function RuleForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: RuleFormData;
  onSave: (data: RuleFormData) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [trigger, setTrigger] = useState(initial?.trigger ?? 'issue:created');
  const [conditions, setConditions] = useState<AutomationCondition[]>(initial?.conditions ?? []);
  const [actions, setActions] = useState<AutomationAction[]>(
    initial?.actions?.length ? initial.actions : [emptyAction()],
  );

  const updateCondition = (idx: number, patch: Partial<AutomationCondition>) => {
    setConditions((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const removeCondition = (idx: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateAction = (idx: number, patch: Partial<AutomationAction>) => {
    setActions((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  };

  const removeAction = (idx: number) => {
    setActions((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name, trigger, conditions, actions });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-surface-elevated border border-border rounded-lg p-5 space-y-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Rule Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Auto-label bugs"
          required
        />
        <Select
          label="Trigger"
          options={TRIGGER_OPTIONS}
          value={trigger}
          onChange={(v) => setTrigger(v as string)}
        />
      </div>

      {/* Conditions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Conditions</h3>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setConditions((prev) => [...prev, emptyCondition()])}
          >
            <PlusCircle className="h-3.5 w-3.5" /> Add Condition
          </Button>
        </div>
        {conditions.length === 0 && (
          <p className="text-xs text-text-tertiary">
            No conditions -- rule fires on every trigger event.
          </p>
        )}
        {conditions.map((cond, idx) => (
          <div key={idx} className="flex items-end gap-2 mb-2">
            <div className="w-36">
              <Select
                options={CONDITION_FIELDS}
                value={cond.field}
                onChange={(v) => updateCondition(idx, { field: v as string })}
                placeholder="Field"
              />
            </div>
            <div className="w-40">
              <Select
                options={CONDITION_OPERATORS}
                value={cond.operator}
                onChange={(v) =>
                  updateCondition(idx, {
                    operator: v as AutomationCondition['operator'],
                  })
                }
                placeholder="Operator"
              />
            </div>
            <div className="flex-1">
              <Input
                value={cond.value ?? cond.values?.join(', ') ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  if (cond.operator === 'in' || cond.operator === 'not_in') {
                    updateCondition(idx, {
                      values: val.split(',').map((s) => s.trim()),
                      value: undefined,
                    });
                  } else {
                    updateCondition(idx, { value: val, values: undefined });
                  }
                }}
                placeholder={
                  cond.operator === 'in' || cond.operator === 'not_in'
                    ? 'Comma-separated values'
                    : 'Value'
                }
              />
            </div>
            <Button type="button" variant="ghost" size="xs" onClick={() => removeCondition(idx)}>
              <X className="h-3.5 w-3.5" /> Remove
            </Button>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Actions</h3>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setActions((prev) => [...prev, emptyAction()])}
          >
            <PlusCircle className="h-3.5 w-3.5" /> Add Action
          </Button>
        </div>
        {actions.map((action, idx) => (
          <div key={idx} className="flex items-end gap-2 mb-2">
            <div className="w-48">
              <Select
                options={ACTION_TYPES}
                value={action.type}
                onChange={(v) => updateAction(idx, { type: v as AutomationAction['type'] })}
                placeholder="Action type"
              />
            </div>
            <div className="flex-1">
              {action.type === 'set_status' && (
                <Input
                  value={action.columnId ?? ''}
                  onChange={(e) => updateAction(idx, { columnId: e.target.value })}
                  placeholder="Column ID"
                />
              )}
              {action.type === 'set_assignee' && (
                <Input
                  value={action.userId ?? ''}
                  onChange={(e) => updateAction(idx, { userId: e.target.value })}
                  placeholder="User ID"
                />
              )}
              {action.type === 'add_label' && (
                <Input
                  value={action.name ?? ''}
                  onChange={(e) => updateAction(idx, { name: e.target.value })}
                  placeholder="Label name"
                />
              )}
              {action.type === 'add_comment' && (
                <Input
                  value={action.body ?? ''}
                  onChange={(e) => updateAction(idx, { body: e.target.value })}
                  placeholder="Comment body"
                />
              )}
            </div>
            <Button type="button" variant="ghost" size="xs" onClick={() => removeAction(idx)}>
              <X className="h-3.5 w-3.5" /> Remove
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-light">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="h-4 w-4" /> Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!name || saving}>
          <Save className="h-4 w-4" /> Save Rule
        </Button>
      </div>
    </form>
  );
}

/**
 *
 */
export default function AutomationRules() {
  const { currentProject } = useProjectContext();
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);

  const {
    data: rules,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['automation-rules', currentProject?.id],
    queryFn: () => automationApi.listRules(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const createMutation = useMutationWithToast(
    (data: {
      name: string;
      trigger: string;
      conditions: AutomationCondition[];
      actions: AutomationAction[];
    }) => automationApi.createRule(currentProject!.id, data),
    {
      successMessage: 'Automation rule created',
      invalidateKeys: [['automation-rules', currentProject?.id]],
      onSuccess: () => setShowForm(false),
    },
  );

  const updateMutation = useMutationWithToast(
    ({ ruleId, data }: { ruleId: string; data: Partial<AutomationRule> }) =>
      automationApi.updateRule(currentProject!.id, ruleId, data),
    {
      successMessage: 'Automation rule updated',
      invalidateKeys: [['automation-rules', currentProject?.id]],
      onSuccess: () => setEditingRule(null),
    },
  );

  const deleteMutation = useMutationWithToast(
    (ruleId: string) => automationApi.deleteRule(currentProject!.id, ruleId),
    {
      successMessage: 'Automation rule deleted',
      invalidateKeys: [['automation-rules', currentProject?.id]],
    },
  );

  const toggleMutation = useMutationWithToast(
    (ruleId: string) => automationApi.toggleRule(currentProject!.id, ruleId),
    {
      successMessage: null,
      invalidateKeys: [['automation-rules', currentProject?.id]],
    },
  );

  const triggerLabel = (trigger: string) =>
    TRIGGER_OPTIONS.find((t) => t.value === trigger)?.label ?? trigger;

  if (isLoading)
    return (
      <div>
        <ListSkeleton rows={4} />
      </div>
    );

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load automation rules</p>
        </div>
      </div>
    );
  }

  return (
    <SettingsPage
      title="Automation Rules"
      description="Automate repetitive workflows with trigger-based rules"
      icon={Zap}
      helpTitle="How automations work"
      helpItems={[
        {
          title: 'Triggers',
          description:
            'Rules fire when a specific event occurs, such as an issue being created, status changing, or a label being added.',
        },
        {
          title: 'Conditions',
          description:
            'Add conditions to narrow when a rule fires. For example, only trigger when priority is Critical or assignee is empty.',
        },
        {
          title: 'Actions',
          description:
            'Define what happens when the rule fires: set a field, add a label, assign a member, post a comment, or move to a column.',
        },
        {
          title: 'Enable/Disable',
          description:
            'Toggle rules on and off without deleting them. Disabled rules are preserved but will not fire.',
        },
      ]}
      actions={
        !showForm && !editingRule ? (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" /> New Rule
          </Button>
        ) : undefined
      }
    >
      {/* Create form */}
      {showForm && (
        <div className="mb-6">
          <RuleForm
            onSave={(data) => createMutation.mutate(data)}
            onCancel={() => setShowForm(false)}
            saving={createMutation.isPending}
          />
        </div>
      )}

      {/* Edit form */}
      {editingRule && (
        <div className="mb-6">
          <RuleForm
            initial={{
              name: editingRule.name,
              trigger: editingRule.trigger,
              conditions: editingRule.conditions,
              actions: editingRule.actions,
            }}
            onSave={(data) => updateMutation.mutate({ ruleId: editingRule.id, data })}
            onCancel={() => setEditingRule(null)}
            saving={updateMutation.isPending}
          />
        </div>
      )}

      {/* Rules list */}
      {rules && rules.length > 0 ? (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="bg-surface-elevated border border-border rounded-lg p-4 flex items-center justify-between"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">{rule.name}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      rule.enabled
                        ? 'bg-success/10 text-success'
                        : 'bg-surface-tertiary text-text-tertiary'
                    }`}
                  >
                    {rule.enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <p className="text-xs text-text-secondary">
                  Trigger: {triggerLabel(rule.trigger)}
                  {(rule.conditions?.length ?? 0) > 0 &&
                    ` | ${rule.conditions.length} condition(s)`}
                  {` | ${rule.actions?.length ?? 0} action(s)`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => toggleMutation.mutate(rule.id)}
                  title={rule.enabled ? 'Disable' : 'Enable'}
                >
                  {rule.enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                  {rule.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setShowForm(false);
                    setEditingRule(rule);
                  }}
                >
                  <Save className="h-4 w-4" /> Edit
                </Button>
                <Button variant="danger" size="xs" onClick={() => deleteMutation.mutate(rule.id)}>
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        !showForm && (
          <EmptyState
            card
            icon={<Bot className="h-10 w-10" />}
            title="No automation rules"
            description="Create rules to automatically assign, label, or move issues based on triggers."
          />
        )
      )}
    </SettingsPage>
  );
}
