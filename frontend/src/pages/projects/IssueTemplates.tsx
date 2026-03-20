import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, X, Pencil, Trash2, FileText } from 'lucide-react';
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
import { Input } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

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

  if (isLoading) return <PageLoader />;

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
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-text">Type</label>
          <select
            value={formType}
            onChange={(e) => setFormType(e.target.value as 'TASK' | 'BUG' | 'STORY' | 'EPIC')}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            {ISSUE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
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
              <button
                key={label.id}
                type="button"
                onClick={() => toggleLabel(label.name)}
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-opacity ${
                  formLabels.includes(label.name)
                    ? 'opacity-100 ring-2 ring-border-focus'
                    : 'opacity-50 hover:opacity-75'
                }`}
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
                {label.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Issue Templates</h1>
          <p className="text-sm text-text-secondary mt-1">
            Create templates to standardize issue creation.
          </p>
        </div>
        <Button onClick={() => setShowAddForm(true)} disabled={showAddForm}>
          <Plus className="h-4 w-4" /> New Template
        </Button>
      </div>

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
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <FileText className="h-8 w-8 text-text-tertiary mx-auto mb-2" />
          <p className="text-text-secondary">No issue templates yet.</p>
          <p className="text-sm text-text-tertiary mt-1">
            Templates help your team create consistent, well-structured issues.
          </p>
        </div>
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
                    onClick={() => {
                      if (window.confirm(`Delete template "${template.name}"?`)) {
                        deleteMutation.mutate(template.id);
                      }
                    }}
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
    </div>
  );
}
