import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';

/**
 *
 */
export default function CreateTeam() {
  const { org } = useParams();
  const navigate = useNavigate();
  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');

  const mutation = useMutationWithToast(
    () => teamsApi.create(currentOrg!.id, { name, slug, description: description || undefined }),
    {
      successMessage: 'Team created',
      errorMessage: 'Failed to create team',
      onSuccess: (team) => navigate(`/${org}/${team.slug}`),
    },
  );

  function handleNameChange(value: string) {
    setName(value);
    setSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentOrg) return;
    mutation.mutate();
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-4">
      <h1 className="text-2xl font-bold mb-6">Create team</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          id="name"
          label="Team name"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="Backend"
          required
        />
        <Input
          id="slug"
          label="URL slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="backend"
          required
        />
        <div>
          <label htmlFor="desc" className="block text-sm font-medium text-text mb-1">
            Description (optional)
          </label>
          <MarkdownEditor
            compact
            value={description}
            onChange={setDescription}
            placeholder="What does this team work on?"
          />
        </div>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <Spinner size="sm" />
          ) : (
            <>
              <Plus className="h-4 w-4" /> Create team
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
