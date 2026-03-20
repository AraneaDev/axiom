import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Settings,
  Trash2,
  GripVertical,
  Save,
  X,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';

import { customFieldsApi, type CustomFieldDefinition } from '@/api/custom-fields.api';
import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { teamsApi } from '@/api/teams.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

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
  const { org, team: teamSlug, project: projectSlug } = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('TEXT');
  const [formOptions, setFormOptions] = useState('');
  const [formRequired, setFormRequired] = useState(false);

  // Resolve project
  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);
  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);
  const { data: projects } = useQuery({
    queryKey: ['projects', currentTeam?.id],
    queryFn: () => projectsApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });
  const currentProject = projects?.find((p) => p.slug === projectSlug);

  const { data: fields = [], isLoading } = useQuery({
    queryKey: ['custom-fields', currentProject?.id],
    queryFn: () => customFieldsApi.listDefinitions(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; type: string; options?: string[]; required?: boolean }) =>
      customFieldsApi.createDefinition(currentProject!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-fields', currentProject?.id] });
      resetForm();
      toast.success('Field created');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      fieldId,
      data,
    }: {
      fieldId: string;
      data: { name?: string; options?: string[]; required?: boolean };
    }) => customFieldsApi.updateDefinition(fieldId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-fields', currentProject?.id] });
      setEditingId(null);
      toast.success('Field updated');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (fieldId: string) => customFieldsApi.deleteDefinition(fieldId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-fields', currentProject?.id] });
      toast.success('Field deleted');
    },
  });

  function resetForm() {
    setShowAddForm(false);
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

  function handleCreate() {
    const options =
      formType === 'SELECT' || formType === 'MULTI_SELECT'
        ? formOptions
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined;
    createMutation.mutate({ name: formName, type: formType, options, required: formRequired });
  }

  function handleUpdate(fieldId: string) {
    const options =
      formType === 'SELECT' || formType === 'MULTI_SELECT'
        ? formOptions
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined;
    updateMutation.mutate({
      fieldId,
      data: { name: formName, options, required: formRequired },
    });
  }

  if (isLoading)
    return (
      <div>
        <ListSkeleton rows={4} />
      </div>
    );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Custom Fields</h1>
          <p className="text-sm text-text-secondary mt-1">
            Define custom fields for issues in this project.
          </p>
        </div>
        <Button onClick={() => setShowAddForm(true)} disabled={showAddForm}>
          <Plus className="h-4 w-4" /> Add Field
        </Button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="rounded-lg border border-border bg-surface p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-secondary font-semibold mb-1">Name</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Field name"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm focus:border-border-focus focus:outline-none"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary font-semibold mb-1">Type</label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm focus:border-border-focus focus:outline-none"
              >
                {FIELD_TYPES.map((ft) => (
                  <option key={ft.value} value={ft.value}>
                    {ft.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {(formType === 'SELECT' || formType === 'MULTI_SELECT') && (
            <div>
              <label className="block text-xs text-text-secondary font-semibold mb-1">
                Options (comma-separated)
              </label>
              <input
                type="text"
                value={formOptions}
                onChange={(e) => setFormOptions(e.target.value)}
                placeholder="Option 1, Option 2, Option 3"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm focus:border-border-focus focus:outline-none"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFormRequired(!formRequired)}
              className="text-text-secondary hover:text-primary transition-colors"
              title={formRequired ? 'Mark as optional' : 'Mark as required'}
            >
              {formRequired ? (
                <ToggleRight className="h-5 w-5 text-primary" />
              ) : (
                <ToggleLeft className="h-5 w-5" />
              )}
            </button>
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
        </div>
      )}

      {/* Field list */}
      {fields.length === 0 && !showAddForm ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-text-secondary">No custom fields defined yet.</p>
          <p className="text-sm text-text-tertiary mt-1">
            Add custom fields to track additional data on your issues.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {fields.map((field) => (
            <div
              key={field.id}
              className="rounded-lg border border-border bg-surface p-4 flex items-center gap-3"
            >
              <GripVertical className="h-4 w-4 text-text-tertiary shrink-0" />

              {editingId === field.id ? (
                <div className="flex-1 space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      className="rounded border border-border bg-surface px-3 py-1.5 text-sm focus:border-border-focus focus:outline-none"
                      autoFocus
                    />
                    <Badge className={TYPE_COLORS[field.type]}>
                      {field.type.replace('_', ' ')}
                    </Badge>
                  </div>
                  {(field.type === 'SELECT' || field.type === 'MULTI_SELECT') && (
                    <input
                      type="text"
                      value={formOptions}
                      onChange={(e) => setFormOptions(e.target.value)}
                      placeholder="Options (comma-separated)"
                      className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm focus:border-border-focus focus:outline-none"
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFormRequired(!formRequired)}
                      className="text-text-secondary hover:text-primary transition-colors"
                      title={formRequired ? 'Mark as optional' : 'Mark as required'}
                    >
                      {formRequired ? (
                        <ToggleRight className="h-5 w-5 text-primary" />
                      ) : (
                        <ToggleLeft className="h-5 w-5" />
                      )}
                    </button>
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
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteTarget(field.id)}
                    className="text-danger hover:text-danger"
                    title="Delete field"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete field confirmation */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete Custom Field"
        size="sm"
      >
        <p className="text-sm text-text-secondary">
          Are you sure you want to delete this field and all its values? This action cannot be
          undone.
        </p>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (deleteTarget) deleteMutation.mutate(deleteTarget);
              setDeleteTarget(null);
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
