import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { wikiApi } from '@/api/wiki.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useTeamContext } from '@/hooks/useTeamContext';

/**
 *
 */
export default function CreateWikiSpace() {
  const { org, teamSlug, currentTeam, isLoading: teamLoading } = useTeamContext();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');

  const mutation = useMutationWithToast(
    () =>
      wikiApi.createSpace(currentTeam!.id, {
        name,
        slug,
        description: description || undefined,
      }),
    {
      successMessage: 'Wiki space created',
      errorMessage: 'Failed to create wiki space',
      onSuccess: () => navigate(`/${org}/${teamSlug}/wiki/${slug}`),
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
    if (!currentTeam) return;
    mutation.mutate();
  }

  if (teamLoading) return <PageLoader />;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="h2 mb-6">Create wiki space</h1>
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
        <div>
          <label htmlFor="desc" className="block text-sm font-medium text-text mb-1">
            Description (optional)
          </label>
          <MarkdownEditor
            compact
            value={description}
            onChange={setDescription}
            placeholder="What kind of documentation goes here?"
          />
        </div>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <Spinner size="sm" />
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
