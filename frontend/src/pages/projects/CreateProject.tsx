import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { teamsApi } from '@/api/teams.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

/**
 *
 */
export default function CreateProject() {
  const { org, team: teamSlug } = useParams();
  const navigate = useNavigate();

  const { data: orgs, isLoading: loadingOrgs } = useQuery({
    queryKey: ['orgs'],
    queryFn: orgsApi.list,
  });
  const currentOrg = orgs?.find((o) => o.slug === org);
  const { data: teams, isLoading: loadingTeams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);

  const toast = useToast();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [prefix, setPrefix] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    setSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    );
    setPrefix(
      value
        .replace(/[^A-Za-z]/g, '')
        .toUpperCase()
        .slice(0, 5),
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentTeam) return;
    setError('');
    setLoading(true);
    try {
      const project = await projectsApi.create(currentTeam.id, {
        name,
        slug,
        prefix,
        description: description || undefined,
      });
      toast.success('Project created');
      navigate(`/${org}/${teamSlug}/${project.slug}/board`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setLoading(false);
    }
  }

  if (loadingOrgs || loadingTeams) return <PageLoader />;

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create project</h1>
      {error && (
        <div className="mb-4 rounded-md bg-danger-light border border-danger/20 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          id="name"
          label="Project name"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="API"
          required
        />
        <Input
          id="slug"
          label="URL slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="api"
          required
        />
        <Input
          id="prefix"
          label="Issue prefix"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value.toUpperCase())}
          placeholder="API"
          required
        />
        <p className="text-xs text-text-secondary -mt-2">
          Issues will be numbered {prefix || 'PRE'}-1, {prefix || 'PRE'}-2, etc.
        </p>
        <div>
          <label htmlFor="desc" className="block text-sm font-medium text-text mb-1">
            Description (optional)
          </label>
          <MarkdownEditor
            compact
            value={description}
            onChange={setDescription}
            placeholder="What is this project about?"
          />
        </div>
        <Button type="submit" disabled={loading}>
          {loading ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <>
              <Plus className="h-4 w-4" /> Create project
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
