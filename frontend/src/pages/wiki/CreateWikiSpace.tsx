import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { wikiApi } from '@/api/wiki.api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';

/**
 *
 */
export default function CreateWikiSpace() {
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

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
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
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentTeam) return;
    setError('');
    setLoading(true);
    try {
      await wikiApi.createSpace(currentTeam.id, {
        name,
        slug,
        description: description || undefined,
      });
      navigate(`/${org}/${teamSlug}/wiki/${slug}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create wiki space');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create wiki space</h1>
      {error && (
        <div className="mb-4 rounded-md bg-danger-light border border-danger/20 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          id="name"
          label="Space name"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="Engineering Docs"
          required
        />
        <Input
          id="slug"
          label="URL slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="eng-docs"
          required
        />
        <Textarea
          id="desc"
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What kind of documentation goes here?"
        />
        <Button type="submit" disabled={loading}>
          {loading ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <>
              <Plus className="h-4 w-4" /> Create space
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
