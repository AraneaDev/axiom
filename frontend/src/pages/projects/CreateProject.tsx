import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { projectsApi } from '@/api/projects.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useTeamContext } from '@/hooks/useTeamContext';

/**
 *
 */
export default function CreateProject() {
  const { org, teamSlug, currentTeam, isLoading: teamLoading } = useTeamContext();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [prefix, setPrefix] = useState('');
  const [description, setDescription] = useState('');

  const mutation = useMutationWithToast(
    () =>
      projectsApi.create(currentTeam!.id, {
        name,
        slug,
        prefix,
        description: description || undefined,
      }),
    {
      successMessage: 'Project created',
      errorMessage: 'Failed to create project',
      onSuccess: (project) => navigate(`/${org}/${teamSlug}/${project.slug}/board`),
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
    setPrefix(
      value
        .replace(/[^A-Za-z]/g, '')
        .toUpperCase()
        .slice(0, 5),
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
      <h1 className="h2 mb-6">Create project</h1>
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
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <Spinner size="sm" />
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
