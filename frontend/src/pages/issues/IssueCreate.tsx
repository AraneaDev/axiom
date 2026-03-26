import { useQuery } from '@tanstack/react-query';
import { Plus, ArrowLeft } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { issueTemplatesApi, type IssueTemplate } from '@/api/issue-templates.api';
import { issuesApi } from '@/api/issues.api';
import { useProjectContext } from '@/hooks/useProjectContext';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

/**
 *
 */
export default function IssueCreate() {
  const { org, teamSlug, projectSlug, currentProject, isLoading: loadingContext } = useProjectContext();
  const navigate = useNavigate();
  const toast = useToast();

  const { data: templates = [] } = useQuery({
    queryKey: ['issue-templates', currentProject?.id],
    queryFn: () => issueTemplatesApi.list(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState('TASK');
  const [priority, setPriority] = useState('MEDIUM');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function applyTemplate(template: IssueTemplate) {
    setTitle(template.title);
    setBody(template.body);
    setType(template.type);
    setSelectedLabels(template.labels ?? []);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentProject) return;
    setError('');
    setLoading(true);
    try {
      const issue = await issuesApi.create(currentProject.id, {
        title,
        body,
        type,
        priority,
        labels: selectedLabels.length > 0 ? selectedLabels : undefined,
      });
      navigate(`/${org}/${teamSlug}/${projectSlug}/issues/${issue.number}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create issue';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  if (loadingContext) return <PageLoader />;

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Create Issue</h1>

      <div className="rounded-lg border border-border bg-surface p-6">
        {templates.length > 0 && (
          <div className="mb-5">
            <Select
              label="From template"
              placeholder="Select a template..."
              onChange={(v) => {
                const tmpl = templates.find((t) => t.id === v);
                if (tmpl) applyTemplate(tmpl);
              }}
              options={templates.map((t) => ({
                value: t.id,
                label: `${t.name} (${t.type})`,
              }))}
            />
          </div>
        )}
        {error && (
          <div className="mb-5 rounded-md bg-danger-light border border-danger/20 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-5">
          <Input
            id="title"
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Type"
              value={type}
              onChange={(v) => setType(v as string)}
              options={[
                { value: 'TASK', label: 'Task' },
                { value: 'BUG', label: 'Bug' },
                { value: 'STORY', label: 'Story' },
                { value: 'EPIC', label: 'Epic' },
              ]}
            />
            <Select
              label="Priority"
              value={priority}
              onChange={(v) => setPriority(v as string)}
              options={[
                { value: 'CRITICAL', label: 'Critical' },
                { value: 'HIGH', label: 'High' },
                { value: 'MEDIUM', label: 'Medium' },
                { value: 'LOW', label: 'Low' },
              ]}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text">Description</label>
            <MarkdownEditor
              value={body}
              onChange={setBody}
              placeholder="Describe the issue in detail..."
              projectId={currentProject?.id}
            />
          </div>

          <div className="flex gap-3 pt-2 border-t border-border-light">
            <Button type="submit" disabled={loading}>
              {loading ? (
                <Spinner size="sm" />
              ) : (
                <>
                  <Plus className="h-4 w-4" /> Create Issue
                </>
              )}
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" /> Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
