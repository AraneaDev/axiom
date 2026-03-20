import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, X, Pencil, Trash2, Tag } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';

import { labelsApi, type LabelWithDescription } from '@/api/labels.api';
import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { teamsApi } from '@/api/teams.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

const PRESET_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#6366f1', // indigo
  '#14b8a6', // teal
];

/**
 *
 */
export default function LabelsSettings() {
  const { org, team: teamSlug, project: projectSlug } = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState(PRESET_COLORS[0]);
  const [formDescription, setFormDescription] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

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

  const { data: labels = [], isLoading } = useQuery({
    queryKey: ['labels', currentProject?.id],
    queryFn: () => labelsApi.list(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; color: string; description?: string }) =>
      labelsApi.create(currentProject!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labels', currentProject?.id] });
      resetForm();
      toast.success('Label created');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      oldName,
      data,
    }: {
      oldName: string;
      data: { name?: string; color?: string; description?: string };
    }) => labelsApi.update(currentProject!.id, oldName, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labels', currentProject?.id] });
      setEditingName(null);
      toast.success('Label updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (labelName: string) => labelsApi.delete(currentProject!.id, labelName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labels', currentProject?.id] });
      toast.success('Label deleted');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function resetForm() {
    setShowAddForm(false);
    setFormName('');
    setFormColor(PRESET_COLORS[0]);
    setFormDescription('');
  }

  function startEdit(label: LabelWithDescription) {
    setEditingName(label.name);
    setFormName(label.name);
    setFormColor(label.color);
    setFormDescription(label.description ?? '');
  }

  function handleCreate() {
    if (!formName.trim() || !formColor.trim()) return;
    createMutation.mutate({
      name: formName.trim(),
      color: formColor,
      description: formDescription.trim() || undefined,
    });
  }

  function handleUpdate(oldName: string) {
    updateMutation.mutate({
      oldName,
      data: {
        name: formName.trim(),
        color: formColor,
        description: formDescription.trim() || undefined,
      },
    });
  }

  if (isLoading) return <PageLoader />;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Labels</h1>
          <p className="text-sm text-text-secondary mt-1">
            Manage labels for issues in this project.
          </p>
        </div>
        <Button onClick={() => setShowAddForm(true)} disabled={showAddForm}>
          <Plus className="h-4 w-4" /> New Label
        </Button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="rounded-lg border border-border bg-surface p-4 mb-4 space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Input
                id="label-name"
                label="Name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Label name"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary font-semibold mb-1">Color</label>
              <div className="flex items-center gap-1.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFormColor(c)}
                    className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: formColor === c ? 'var(--color-text)' : 'transparent',
                    }}
                    title={c}
                  />
                ))}
                <input
                  type="text"
                  value={formColor}
                  onChange={(e) => setFormColor(e.target.value)}
                  className="w-20 rounded border border-border bg-surface px-2 py-1 text-xs font-mono focus:border-border-focus focus:outline-none"
                  placeholder="#hex"
                />
              </div>
            </div>
          </div>
          <div>
            <label htmlFor="label-desc" className="block text-sm font-medium text-text mb-1">
              Description (optional)
            </label>
            <MarkdownEditor
              compact
              value={formDescription}
              onChange={setFormDescription}
              placeholder="Short description of this label"
              projectId={currentProject?.id}
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              disabled={!formName.trim() || !formColor.trim() || createMutation.isPending}
              onClick={handleCreate}
            >
              <Save className="h-4 w-4" /> Create Label
            </Button>
            <Button variant="ghost" size="sm" onClick={resetForm}>
              <X className="h-4 w-4" /> Cancel
            </Button>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs text-text-tertiary">Preview:</span>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
              style={{ backgroundColor: formColor }}
            >
              {formName || 'label'}
            </span>
          </div>
        </div>
      )}

      {/* Label list */}
      {labels.length === 0 && !showAddForm ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <Tag className="h-8 w-8 text-text-tertiary mx-auto mb-2" />
          <p className="text-text-secondary">No labels defined yet.</p>
          <p className="text-sm text-text-tertiary mt-1">
            Create labels to categorize and filter issues.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {labels.map((label) => (
            <div
              key={label.id}
              className="rounded-lg border border-border bg-surface p-4 flex items-center gap-3"
            >
              {editingName === label.name ? (
                <div className="flex-1 space-y-3">
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <Input
                        id={`edit-name-${label.id}`}
                        label="Name"
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-secondary font-semibold mb-1">
                        Color
                      </label>
                      <div className="flex items-center gap-1.5">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setFormColor(c)}
                            className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                            style={{
                              backgroundColor: c,
                              borderColor: formColor === c ? 'var(--color-text)' : 'transparent',
                            }}
                            title={c}
                          />
                        ))}
                        <input
                          type="text"
                          value={formColor}
                          onChange={(e) => setFormColor(e.target.value)}
                          className="w-20 rounded border border-border bg-surface px-2 py-1 text-xs font-mono focus:border-border-focus focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor={`edit-desc-${label.id}`}
                      className="block text-sm font-medium text-text mb-1"
                    >
                      Description
                    </label>
                    <MarkdownEditor
                      compact
                      value={formDescription}
                      onChange={setFormDescription}
                      projectId={currentProject?.id}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleUpdate(label.name)}
                      disabled={updateMutation.isPending}
                    >
                      <Save className="h-4 w-4" /> Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingName(null)}>
                      <X className="h-4 w-4" /> Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <span
                    className="w-4 h-4 rounded-full shrink-0"
                    style={{ backgroundColor: label.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{label.name}</span>
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                        style={{ backgroundColor: label.color }}
                      >
                        {label.name}
                      </span>
                    </div>
                    {label.description && (
                      <div className="text-xs text-text-tertiary mt-0.5">
                        <MarkdownRenderer content={label.description} />
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startEdit(label)}
                    title="Edit label"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteTarget(label.name)}
                    className="text-danger hover:text-danger"
                    title="Delete label"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete label"
        size="sm"
      >
        <p className="text-secondary">
          Delete label &quot;{deleteTarget}&quot;? It will be removed from all issues.
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
