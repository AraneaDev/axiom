import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Trash2, Settings, AlertTriangle, GitMerge } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import WebhooksSettings from './WebhooksSettings';

import { reposApi } from '@/api/repos.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useRepoContext } from '@/hooks/useRepoContext';

/**
 *
 */
export default function RepoSettings() {
  const { currentRepo, basePath, org, teamSlug } = useRepoContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'PRIVATE' | 'INTERNAL' | 'PUBLIC'>('PRIVATE');
  const [defaultBranch, setDefaultBranch] = useState('');
  const [defaultMergeStrategy, setDefaultMergeStrategy] = useState('MERGE');
  const [initialized, setInitialized] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  // Initialize form values once repo loads
  if (currentRepo && !initialized) {
    setName(currentRepo.name);
    setDescription(currentRepo.description ?? '');
    setVisibility(currentRepo.visibility);
    setDefaultBranch(currentRepo.defaultBranch);
    setDefaultMergeStrategy(currentRepo.defaultMergeStrategy ?? 'MERGE');
    setInitialized(true);
  }

  const updateMutation = useMutation({
    mutationFn: (
      data: Partial<{
        name: string;
        description: string;
        visibility: 'PRIVATE' | 'INTERNAL' | 'PUBLIC';
        defaultBranch: string;
      }>,
    ) => reposApi.update(currentRepo!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] });
      toast.success('Repository settings saved');
    },
  });

  const settingsMutation = useMutation({
    mutationFn: (data: { defaultMergeStrategy?: string }) =>
      reposApi.updateSettings(currentRepo!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] });
      toast.success('Merge settings saved');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => reposApi.delete(currentRepo!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] });
      navigate(`/${org}/${teamSlug}/repos`);
    },
  });

  if (!currentRepo)
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-7 w-56" />
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-6 space-y-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-8 w-32 rounded-md" />
          </div>
        ))}
      </div>
    );

  const handleSave = () => {
    updateMutation.mutate({ name, description, visibility, defaultBranch });
  };

  const handleDelete = () => {
    if (deleteConfirm === currentRepo.slug) {
      deleteMutation.mutate();
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <Link
          to={basePath}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-3"
        >
          <ArrowLeft className="h-3 w-3" /> Back to repository
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Settings className="h-5 w-5" /> Repository Settings
        </h1>
      </div>

      {/* General settings */}
      <div className="rounded-lg border border-border bg-surface p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">General</h2>
        <div className="space-y-4">
          <Input label="Repository name" value={name} onChange={(e) => setName(e.target.value)} />
          <div>
            <label className="block text-sm font-medium text-text mb-1">Description</label>
            <MarkdownEditor compact value={description} onChange={setDescription} />
          </div>
          <Select
            label="Visibility"
            value={visibility}
            onChange={(v) => setVisibility(v as 'PRIVATE' | 'INTERNAL' | 'PUBLIC')}
            options={[
              { value: 'PRIVATE', label: 'Private' },
              { value: 'INTERNAL', label: 'Internal' },
              { value: 'PUBLIC', label: 'Public' },
            ]}
          />
          <Input
            label="Default branch"
            value={defaultBranch}
            onChange={(e) => setDefaultBranch(e.target.value)}
          />
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            <Save className="h-4 w-4" /> {updateMutation.isPending ? 'Saving...' : 'Save changes'}
          </Button>
          {updateMutation.isSuccess && <p className="text-sm text-success mt-2">Settings saved.</p>}
        </div>
      </div>

      {/* Merge settings */}
      <div className="rounded-lg border border-border bg-surface p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <GitMerge className="h-5 w-5" /> Merge Settings
        </h2>
        <div className="space-y-4">
          <Select
            label="Default merge strategy"
            value={defaultMergeStrategy}
            onChange={(v) => setDefaultMergeStrategy(v as string)}
            options={[
              { value: 'MERGE', label: 'Merge commit' },
              { value: 'SQUASH', label: 'Squash and merge' },
              { value: 'REBASE', label: 'Rebase and merge' },
            ]}
          />
          <p className="text-xs text-text-secondary">
            This strategy will be pre-selected when merging pull requests targeting any branch.
          </p>
          <Button
            onClick={() => settingsMutation.mutate({ defaultMergeStrategy })}
            disabled={settingsMutation.isPending}
          >
            <Save className="h-4 w-4" />{' '}
            {settingsMutation.isPending ? 'Saving...' : 'Save merge settings'}
          </Button>
          {settingsMutation.isSuccess && (
            <p className="text-sm text-success mt-2">Merge settings saved.</p>
          )}
        </div>
      </div>

      {/* Webhooks */}
      <div className="rounded-lg border border-border bg-surface p-6 mb-6">
        <WebhooksSettings repoId={currentRepo.id} />
      </div>

      {/* Danger zone */}
      <div className="rounded-lg border border-danger bg-surface p-6">
        <h2 className="text-lg font-semibold text-danger flex items-center gap-2 mb-4">
          <AlertTriangle className="h-5 w-5" /> Danger Zone
        </h2>
        <p className="text-sm text-text-secondary mb-4">
          Deleting a repository is permanent and cannot be undone. All code, pull requests, and
          pipeline data will be lost.
        </p>
        <div className="space-y-3">
          <Input
            label={`Type "${currentRepo.slug}" to confirm`}
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={currentRepo.slug}
          />
          <Button
            variant="danger"
            onClick={handleDelete}
            disabled={deleteConfirm !== currentRepo.slug || deleteMutation.isPending}
          >
            <Trash2 className="h-4 w-4" />{' '}
            {deleteMutation.isPending ? 'Deleting...' : 'Delete this repository'}
          </Button>
        </div>
      </div>
    </div>
  );
}
