import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';

/**
 *
 */
export default function CreateOrg() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');

  const mutation = useMutationWithToast(
    () => orgsApi.create({ name, slug, description: description || undefined }),
    {
      successMessage: 'Organization created',
      errorMessage: 'Failed to create organization',
      onSuccess: (org) => navigate(`/${org.slug}`),
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
    mutation.mutate();
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-4">
      <h1 className="text-2xl font-bold mb-6">Create organization</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          id="name"
          label="Organization name"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="My Company"
          required
        />
        <Input
          id="slug"
          label="URL slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="my-company"
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
            placeholder="What is this organization for?"
          />
        </div>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <Spinner size="sm" />
          ) : (
            <>
              <Plus className="h-4 w-4" /> Create organization
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
