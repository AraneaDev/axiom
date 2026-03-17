import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { orgsApi } from '@/api/orgs.api';

export default function CreateOrg() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const org = await orgsApi.create({ name, slug, description: description || undefined });
      navigate(`/${org.slug}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create organization');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create organization</h1>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-danger">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input id="name" label="Organization name" value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="My Company" required />
        <Input id="slug" label="URL slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-company" required />
        <div className="flex flex-col gap-1">
          <label htmlFor="desc" className="text-sm font-medium text-text">Description (optional)</label>
          <textarea
            id="desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-text-secondary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            rows={3}
            placeholder="What is this organization for?"
          />
        </div>
        <Button type="submit" disabled={loading}>
          {loading ? <Spinner className="h-4 w-4" /> : 'Create organization'}
        </Button>
      </form>
    </div>
  );
}
