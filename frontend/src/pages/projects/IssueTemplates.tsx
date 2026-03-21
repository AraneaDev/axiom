import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, X, Pencil, Trash2, FileText, Tag } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';

import { issueTemplatesApi, type IssueTemplate } from '@/api/issue-templates.api';
import { labelsApi } from '@/api/labels.api';
import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { teamsApi } from '@/api/teams.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Select } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

const ISSUE_TYPES = [
  { value: 'TASK', label: 'Task' },
  { value: 'BUG', label: 'Bug' },
  { value: 'STORY', label: 'Story' },
  { value: 'EPIC', label: 'Epic' },
];

const TYPE_BADGE_CLASS: Record<string, string> = {
  TASK: 'bg-primary-light text-primary',
  BUG: 'bg-danger-light text-danger',
  STORY: 'bg-success/10 text-success',
  EPIC: 'bg-warning/10 text-warning',
};

/**
 *
 */
export default function IssueTemplates() {
  const { org, team: teamSlug, project: projectSlug } = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'TASK' | 'BUG' | 'STORY' | 'EPIC'>('TASK');
  const [formTitle, setFormTitle] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formLabels, setFormLabels] = useState<string[]>([]);

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

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['issue-templates', currentProject?.id],
    queryFn: () => issueTemplatesApi.list(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const { data: projectLabels = [] } = useQuery({
    queryKey: ['labels', currentProject?.id],
    queryFn: () => labelsApi.list(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const createMutation = useMutation({
    mutationFn: (data: Omit<IssueTemplate, 'id'>) =>
      issueTemplatesApi.create(currentProject!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-templates', currentProject?.id] });
      resetForm();
      toast.success('Template created');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      templateId,
      data,
    }: {
      templateId: string;
      data: Partial<Omit<IssueTemplate, 'id'>>;
    }) => issueTemplatesApi.update(currentProject!.id, templateId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-templates', currentProject?.id] });
      setEditingId(null);
      toast.success('Template updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (templateId: string) => issueTemplatesApi.delete(currentProject!.id, templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-templates', currentProject?.id] });
      toast.success('Template deleted');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function resetForm() {
    setShowAddForm(false);
    setEditingId(null);
    setFormName('');
    setFormType('TASK');
    setFormTitle('');
    setFormBody('');
    setFormLabels([]);
  }

  function startEdit(template: IssueTemplate) {
    setEditingId(template.id);
    setFormName(template.name);
    setFormType(template.type);
    setFormTitle(template.title);
    setFormBody(template.body);
    setFormLabels(template.labels ?? []);
  }

  function handleCreate() {
    if (!formName.trim() || !formTitle.trim()) return;
    createMutation.mutate({
      name: formName.trim(),
      type: formType,
      title: formTitle.trim(),
      body: formBody,
      labels: formLabels,
    });
  }

  function handleUpdate(templateId: string) {
    updateMutation.mutate({
      templateId,
      data: {
        name: formName.trim(),
        type: formType,
        title: formTitle.trim(),
        body: formBody,
        labels: formLabels,
      },
    });
  }

  function toggleLabel(labelName: string) {
    setFormLabels((prev) =>
      prev.includes(labelName) ? prev.filter((l) => l !== labelName) : [...prev, labelName],
    );
  }

  if (isLoading)
    return (
      <div>
        <ListSkeleton rows={3} />
      </div>
    );

  const templateForm = (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input
          id="template-name"
          label="Template Name"
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
          placeholder="e.g., Bug Report"
          autoFocus
        />
        <Select
          label="Type"
          value={formType}
          onChange={(v) => setFormType(v as 'TASK' | 'BUG' | 'STORY' | 'EPIC')}
          options={ISSUE_TYPES}
        />
      </div>

      <Input
        id="template-title"
        label="Title Pattern"
        value={formTitle}
        onChange={(e) => setFormTitle(e.target.value)}
        placeholder="e.g., [Bug] ..."
      />

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-text">Body (Markdown)</label>
        <MarkdownEditor
          value={formBody}
          onChange={setFormBody}
          placeholder="Template content..."
          projectId={currentProject?.id}
        />
      </div>

      {projectLabels.length > 0 && (
        <div>
          <label className="block text-xs text-text-secondary font-semibold mb-1">
            Default Labels
          </label>
          <div className="flex flex-wrap gap-1.5">
            {projectLabels.map((label) => (
              <Button
                key={label.id}
                variant="ghost"
                size="xs"
                onClick={() => toggleLabel(label.name)}
                className={cn(
                  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-opacity',
                  formLabels.includes(label.name)
                    ? 'opacity-100 ring-2 ring-border-focus'
                    : 'opacity-50 hover:opacity-75',
                )}
                style={{
                  backgroundColor: label.color + '20',
                  color: label.color,
                }}
                title={
                  formLabels.includes(label.name)
                    ? `Remove ${label.name} label`
                    : `Add ${label.name} label`
                }
              >
                <Tag className="h-3 w-3" /> {label.name}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <SettingsPage
      title="Issue Templates"
      description="Create reusable templates to standardize issue creation"
      icon={FileText}
      helpTitle="About templates"
      helpItems={[
        {
          title: 'Template types',
          description:
            'Match templates to issue types (Bug, Feature, Task, etc.) to pre-fill the type field automatically.',
        },
        {
          title: 'Template body',
          description:
            'Use Markdown to create structured templates with headings, checklists, and sections that guide the issue creator.',
        },
        {
          title: 'Default labels',
          description:
            'Attach labels to templates so they are automatically applied to new issues created from the template.',
        },
      ]}
      actions={
        <Button onClick={() => setShowAddForm(true)} disabled={showAddForm}>
          <Plus className="h-4 w-4" /> New Template
        </Button>
      }
    >
      {/* Add form */}
      {showAddForm && (
        <div className="rounded-lg border border-border bg-surface p-4 mb-4">
          {templateForm}
          <div className="flex items-center gap-2 pt-3">
            <Button
              size="sm"
              disabled={!formName.trim() || !formTitle.trim() || createMutation.isPending}
              onClick={handleCreate}
            >
              <Save className="h-4 w-4" /> Create Template
            </Button>
            <Button variant="ghost" size="sm" onClick={resetForm}>
              <X className="h-4 w-4" /> Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Template list */}
      {templates.length === 0 && !showAddForm ? (
        <EmptyState
          card
          icon={<FileText />}
          title="No issue templates"
          description="Templates help your team create consistent, well-structured issues."
          action={
            <Button onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4" /> New Template
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {templates.map((template) => (
            <div key={template.id} className="rounded-lg border border-border bg-surface p-4">
              {editingId === template.id ? (
                <div>
                  {templateForm}
                  <div className="flex items-center gap-2 pt-3">
                    <Button
                      size="sm"
                      onClick={() => handleUpdate(template.id)}
                      disabled={updateMutation.isPending}
                    >
                      <Save className="h-4 w-4" /> Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={resetForm}>
                      <X className="h-4 w-4" /> Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-text-tertiary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{template.name}</span>
                      <Badge className={TYPE_BADGE_CLASS[template.type]}>{template.type}</Badge>
                    </div>
                    <p className="text-xs text-text-tertiary mt-0.5 truncate">
                      Title: {template.title}
                    </p>
                    {template.labels.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {template.labels.map((l) => {
                          const labelDef = projectLabels.find((pl) => pl.name === l);
                          return (
                            <span
                              key={l}
                              className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor: (labelDef?.color ?? '#6366f1') + '20',
                                color: labelDef?.color ?? '#6366f1',
                              }}
                            >
                              {l}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startEdit(template)}
                    title="Edit template"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteTarget(template.id)}
                    className="text-danger hover:text-danger"
                    title="Delete template"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete template confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
        title="Delete Template"
        description="Are you sure you want to delete this template? This action cannot be undone."
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </SettingsPage>
  );
}
