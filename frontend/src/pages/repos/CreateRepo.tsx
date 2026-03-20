import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { reposApi } from '@/api/repos.api';
import { teamsApi } from '@/api/teams.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

/**
 *
 */
export default function CreateRepo() {
  const { org, team: teamSlug } = useParams();
  const navigate = useNavigate();
  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);
  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);

  const toast = useToast();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('PRIVATE');
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
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentTeam) return;
    setError('');
    setLoading(true);
    try {
      await reposApi.create(currentTeam.id, {
        name,
        slug,
        description: description || undefined,
        visibility,
      });
      toast.success('Repository created');
      navigate(`/${org}/${teamSlug}/repos/${slug}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create repository');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create repository</h1>
      {error && (
        <div className="mb-4 rounded-md bg-danger-light border border-danger/20 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          id="name"
          label="Repository name"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="my-app"
          required
        />
        <Input
          id="slug"
          label="URL slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="my-app"
          required
        />
        <Select
          label="Visibility"
          value={visibility}
          onChange={(v) => setVisibility(v as string)}
          options={[
            { value: 'PRIVATE', label: 'Private' },
            { value: 'INTERNAL', label: 'Internal (org-visible)' },
            { value: 'PUBLIC', label: 'Public' },
          ]}
        />
        <div>
          <label htmlFor="desc" className="block text-sm font-medium text-text mb-1">
            Description (optional)
          </label>
          <MarkdownEditor
            compact
            value={description}
            onChange={setDescription}
            placeholder="What is this repository for?"
          />
        </div>
        <Button type="submit" disabled={loading}>
          {loading ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <>
              <Plus className="h-4 w-4" /> Create repository
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
