import { useQuery } from '@tanstack/react-query';
import { ListPlus, Plus, Settings, Trash2, GripVertical, Save, X } from 'lucide-react';
import { useState } from 'react';

import { customFieldsApi, type CustomFieldDefinition } from '@/api/custom-fields.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Select } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { Toggle } from '@/components/ui/Toggle';
import { useCRUDSettings } from '@/hooks/useCRUDSettings';
import { useProjectContext } from '@/hooks/useProjectContext';

const FIELD_TYPES = [
  { value: 'TEXT', label: 'Text' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'DATE', label: 'Date' },
  { value: 'SELECT', label: 'Select' },
  { value: 'MULTI_SELECT', label: 'Multi Select' },
  { value: 'USER', label: 'User' },
];

const TYPE_COLORS: Record<string, string> = {
  TEXT: 'bg-surface-secondary text-text-secondary',
  NUMBER: 'bg-primary-light text-primary',
  DATE: 'bg-warning/10 text-warning',
  SELECT: 'bg-success/10 text-success',
  MULTI_SELECT: 'bg-primary-light text-primary',
  USER: 'bg-danger-light text-danger',
};

/**
 *
 */
export default function CustomFieldSettings() {
  const { currentProject } = useProjectContext();

  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('TEXT');
  const [formOptions, setFormOptions] = useState('');
  const [formRequired, setFormRequired] = useState(false);

  const { data: fields = [], isLoading } = useQuery({
    queryKey: ['custom-fields', currentProject?.id],
    queryFn: () => customFieldsApi.listDefinitions(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const {
    showAddForm,
    setShowAddForm,
    editingId,
    setEditingId,
    deleteTarget,
    setDeleteTarget,
    resetForm: resetCRUD,
    createMutation,
    updateMutation,
    deleteMutation,
    confirmDelete,
  } = useCRUDSettings<
    { name: string; type: string; options?: string[]; required?: boolean },
    { name?: string; options?: string[]; required?: boolean },
    string
  >({
    queryKey: ['custom-fields', currentProject?.id],
    createFn: (data) => customFieldsApi.createDefinition(currentProject!.id, data),
    updateFn: (fieldId, data) => customFieldsApi.updateDefinition(fieldId, data),
    deleteFn: (fieldId) => customFieldsApi.deleteDefinition(fieldId),
    entityName: 'Field',
    onCreateSuccess: () => {
      setFormName('');
      setFormType('TEXT');
      setFormOptions('');
      setFormRequired(false);
    },
  });

  function resetForm() {
    resetCRUD();
    setFormName('');
    setFormType('TEXT');
    setFormOptions('');
    setFormRequired(false);
  }

  function startEdit(field: CustomFieldDefinition) {
    setEditingId(field.id);
    setFormName(field.name);
    setFormType(field.type);
    setFormOptions(Array.isArray(field.options) ? field.options.join(', ') : '');
    setFormRequired(field.required);
  }

  function parseOptions() {
    return formType === 'SELECT' || formType === 'MULTI_SELECT'
      ? formOptions
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean)
      : undefined;
  }

  function handleCreate() {
    if (!formName.trim()) return;
    createMutation.mutate({
      name: formName,
      type: formType,
      options: parseOptions(),
      required: formRequired,
    });
  }

  function handleUpdate(fieldId: string) {
    updateMutation.mutate({
      id: fieldId,
      data: { name: formName, options: parseOptions(), required: formRequired },
    });
  }

  if (isLoading)
    return (
      <div>
        <ListSkeleton rows={4} />
      </div>
    );

  return (
    <SettingsPage
      title="Custom Fields"
      description="Define additional fields to capture project-specific data on issues"
      icon={ListPlus}
      helpTitle="Field types"
      helpItems={[
        {
          title: 'Text & Number',
          description:
            'Free-form input fields for short text values or numeric data like story points or estimates.',
        },
        {
          title: 'Select & Multi-select',
          description:
            'Dropdown fields with predefined options. Add options as comma-separated values when creating the field.',
        },
        {
          title: 'Date & Checkbox',
          description:
            "Date picker for deadlines or milestones. Checkbox for boolean flags like 'Approved' or 'Reviewed'.",
        },
        {
          title: 'Required fields',
          description:
            'Mark a field as required to ensure it is filled out when creating or editing issues.',
        },
      ]}
      actions={
        <Button onClick={() => setShowAddForm(true)} disabled={showAddForm}>
          <Plus className="h-4 w-4" /> Add Field
        </Button>
      }
    >
      {/* Add form */}
      {showAddForm && (
        <Card className="p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Field name"
              autoFocus
            />
            <Select
              label="Type"
              value={formType}
              onChange={(v) => setFormType(v as string)}
              options={FIELD_TYPES}
            />
          </div>

          {(formType === 'SELECT' || formType === 'MULTI_SELECT') && (
            <Input
              label="Options (comma-separated)"
              value={formOptions}
              onChange={(e) => setFormOptions(e.target.value)}
              placeholder="Option 1, Option 2, Option 3"
            />
          )}

          <div className="flex items-center gap-2">
            <Toggle checked={formRequired} onChange={(val) => setFormRequired(val)} size="sm" />
            <span className="text-sm text-text-secondary">Required</span>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              disabled={!formName.trim() || createMutation.isPending}
              onClick={handleCreate}
            >
              <Save className="h-4 w-4" /> Create Field
            </Button>
            <Button variant="ghost" size="sm" onClick={resetForm}>
              <X className="h-4 w-4" /> Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Field list */}
      {fields.length === 0 && !showAddForm ? (
        <EmptyState
          card
          icon={<Settings />}
          title="No custom fields defined"
          description="Add custom fields to track additional data on your issues."
          action={
            <Button onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4" /> Add Field
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {fields.map((field) => (
            <Card key={field.id} className="p-4 flex items-center gap-3">
              <GripVertical className="h-4 w-4 text-text-tertiary shrink-0" />

              {editingId === field.id ? (
                <div className="flex-1 space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      autoFocus
                    />
                    <Badge className={TYPE_COLORS[field.type]}>
                      {field.type.replace('_', ' ')}
                    </Badge>
                  </div>
                  {(field.type === 'SELECT' || field.type === 'MULTI_SELECT') && (
                    <Input
                      value={formOptions}
                      onChange={(e) => setFormOptions(e.target.value)}
                      placeholder="Options (comma-separated)"
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <Toggle
                      checked={formRequired}
                      onChange={(val) => setFormRequired(val)}
                      size="sm"
                    />
                    <span className="text-sm text-text-secondary">Required</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleUpdate(field.id)}
                      disabled={updateMutation.isPending}
                    >
                      <Save className="h-4 w-4" /> Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                      <X className="h-4 w-4" /> Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{field.name}</span>
                      <Badge className={TYPE_COLORS[field.type]}>
                        {field.type.replace('_', ' ')}
                      </Badge>
                      {field.required && (
                        <Badge variant="outline" className="text-[10px]">
                          Required
                        </Badge>
                      )}
                    </div>
                    {Array.isArray(field.options) && field.options.length > 0 && (
                      <p className="text-xs text-text-tertiary mt-0.5">
                        Options: {(field.options as string[]).join(', ')}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startEdit(field)}
                    title="Edit field"
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setDeleteTarget(field.id)}
                    title="Delete field"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Delete field confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete Custom Field"
        description="Are you sure you want to delete this field and all its values? This action cannot be undone."
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </SettingsPage>
  );
}
