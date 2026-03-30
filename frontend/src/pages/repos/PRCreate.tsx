import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, GitPullRequest, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { reposApi } from '@/api/repos.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useRepoContext } from '@/hooks/useRepoContext';

/**
 *
 */
export default function PRCreate() {
  const { currentRepo, basePath } = useRepoContext();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sourceBranch, setSourceBranch] = useState('');
  const [targetBranch, setTargetBranch] = useState('');
  const [templateApplied, setTemplateApplied] = useState(false);

  // Pre-fill body with PR template if available (once)
  if (currentRepo?.prTemplate && !templateApplied && !body) {
    setBody(currentRepo.prTemplate);
    setTemplateApplied(true);
  }

  const { data: branches } = useQuery({
    queryKey: ['branches', currentRepo?.id],
    queryFn: () => reposApi.listBranches(currentRepo!.id),
    enabled: !!currentRepo?.id,
  });

  const branchOptions = (branches ?? []).map((b) => ({ value: b.name, label: b.name }));

  const { mutate: createPR, isPending } = useMutationWithToast(
    () => reposApi.createPR(currentRepo!.id, { title, body, sourceBranch, targetBranch }),
    {
      successMessage: 'Pull request created successfully.',
      errorMessage: 'Failed to create pull request.',
      onSuccess: (pr) => navigate(`${basePath}/pulls/${pr.number}`),
    },
  );

  const sameBranch = sourceBranch && targetBranch && sourceBranch === targetBranch;
  const canSubmit = title.trim() && sourceBranch && targetBranch && !sameBranch && !isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    createPR();
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to={`${basePath}/pulls`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> Back to Pull Requests
          </Button>
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-6">
        <GitPullRequest className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">New Pull Request</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Source Branch"
            placeholder="Select source branch..."
            options={branchOptions}
            value={sourceBranch}
            onChange={(v) => setSourceBranch(v as string)}
            disabled={!currentRepo}
          />
          <Select
            label="Target Branch"
            placeholder="Select target branch..."
            options={branchOptions}
            value={targetBranch}
            onChange={(v) => setTargetBranch(v as string)}
            disabled={!currentRepo}
          />
        </div>

        {sameBranch && (
          <div className="flex items-center gap-2 rounded-md border border-warning bg-warning-light px-3 py-2 text-sm text-text">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
            Source and target branches must be different.
          </div>
        )}

        <Input
          label="Title"
          placeholder="Pull request title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text">Description</label>
          <MarkdownEditor value={body} onChange={setBody} placeholder="Describe your changes..." />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Link to={`${basePath}/pulls`}>
            <Button type="button" variant="secondary">
              <ArrowLeft className="h-4 w-4" /> Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={!canSubmit}>
            <Plus className="h-4 w-4" /> Create Pull Request
          </Button>
        </div>
      </form>
    </div>
  );
}
