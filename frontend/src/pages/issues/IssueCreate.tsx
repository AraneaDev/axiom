import { useQuery } from '@tanstack/react-query';
import { Plus, ArrowLeft } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { issueTemplatesApi, type IssueTemplate } from '@/api/issue-templates.api';
import { issuesApi } from '@/api/issues.api';
import { teamsApi } from '@/api/teams.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useProjectContext } from '@/hooks/useProjectContext';
import { STABLE_STALE_TIME } from '@/lib/constants';

/**
 *
 */
export default function IssueCreate() {
  const {
    org,
    teamSlug,
    projectSlug,
    currentTeam,
    currentProject,
    isLoading: loadingContext,
  } = useProjectContext();
  const navigate = useNavigate();

  const { data: templates = [] } = useQuery({
    queryKey: ['issue-templates', currentProject?.id],
    queryFn: () => issueTemplatesApi.list(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const { data: teamDetail } = useQuery({
    queryKey: ['team-detail', currentTeam?.id],
    queryFn: () => teamsApi.get(currentTeam!.id),
    enabled: !!currentTeam?.id,
    staleTime: STABLE_STALE_TIME,
  });

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState('TASK');
  const [priority, setPriority] = useState('MEDIUM');
  const [assigneeId, setAssigneeId] = useState('');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');

  const mutation = useMutationWithToast(
    () =>
      issuesApi.create(currentProject!.id, {
        title,
        body,
        type,
        priority,
        assigneeId: assigneeId || undefined,
        labels: selectedLabels.length > 0 ? selectedLabels : undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      }),
    {
      successMessage: null,
      errorMessage: 'Failed to create issue',
      onSuccess: (issue) => navigate(`/${org}/${teamSlug}/${projectSlug}/issues/${issue.number}`),
    },
  );

  function applyTemplate(template: IssueTemplate) {
    setTitle(template.title);
    setBody(template.body);
    setType(template.type);
    setSelectedLabels(template.labels ?? []);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentProject) return;
    mutation.mutate();
  }

  if (loadingContext) return <PageLoader />;

  const memberOptions = [
    { value: '', label: 'Unassigned' },
    ...(teamDetail?.members ?? []).map((m: { user: { id: string; displayName: string } }) => ({
      value: m.user.id,
      label: m.user.displayName,
    })),
  ];

  return (
    <div className="">
      <div className="flex items-center justify-between mb-6">
        <h1 className="h2">Create Issue</h1>
      </div>

      <div className="flex gap-6">
        {/* Main form - left side */}
        <div className="flex-1 min-w-0">
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

          <form onSubmit={handleSubmit} className="space-y-5">
            <Input
              id="title"
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              required
            />

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-text">Description</span>
              <MarkdownEditor
                value={body}
                onChange={setBody}
                placeholder="Describe the issue in detail..."
                projectId={currentProject?.id}
              />
            </div>

            <div className="flex gap-3 pt-4 border-t border-border">
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? (
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

        {/* Sidebar - right side */}
        <div className="w-72 shrink-0 space-y-4">
          <Card className="p-5 space-y-4">
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

            <Select
              label="Assignee"
              value={assigneeId}
              onChange={(v) => setAssigneeId(v as string)}
              options={memberOptions}
              placeholder="Unassigned"
            />

            <Input
              id="labels"
              label="Labels"
              value={selectedLabels.join(', ')}
              onChange={(e) =>
                setSelectedLabels(
                  e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
              placeholder="bug, frontend, urgent"
              hint="Comma-separated label names"
            />

            <Input
              id="dueDate"
              label="Due date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
