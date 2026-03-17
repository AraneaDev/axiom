import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { issuesApi } from '@/api/issues.api';
import { projectsApi } from '@/api/projects.api';
import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';

export default function IssueCreate() {
  const { org, team: teamSlug, project: projectSlug } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

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

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState('TASK');
  const [priority, setPriority] = useState('MEDIUM');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentProject) return;
    setError('');
    setLoading(true);
    try {
      const issue = await issuesApi.create(currentProject.id, { title, body, type, priority });
      navigate(`/${org}/${teamSlug}/${projectSlug}/issues/${issue.number}`);
    } catch (err: any) {
      const message = err.message || 'Failed to create issue';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create Issue</h1>
      {error && <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-danger">{error}</div>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input id="title" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" required />

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-text">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
              <option value="TASK">Task</option>
              <option value="BUG">Bug</option>
              <option value="STORY">Story</option>
              <option value="EPIC">Epic</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-text">Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-text">Description</label>
          <MarkdownEditor
            value={body}
            onChange={setBody}
            placeholder="Describe the issue in detail..."
          />
        </div>

        <div className="flex gap-3">
          <Button type="submit" disabled={loading}>
            {loading ? <Spinner className="h-4 w-4" /> : 'Create Issue'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
