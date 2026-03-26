import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, GitPullRequest, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { reposApi } from '@/api/repos.api';
import { teamsApi } from '@/api/teams.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Dropdown';
import { useToast } from '@/components/ui/Toast';
import { STABLE_STALE_TIME } from '@/lib/constants';

/**
 *
 */
export default function PRCreate() {
  const { org, team: teamSlug, repo: repoSlug } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sourceBranch, setSourceBranch] = useState('');
  const [targetBranch, setTargetBranch] = useState('');

  const { data: orgs } = useQuery({
    queryKey: ['orgs'],
    queryFn: orgsApi.list,
    staleTime: STABLE_STALE_TIME,
  });
  const currentOrg = orgs?.find((o) => o.slug === org);

  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
    staleTime: STABLE_STALE_TIME,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);

  const { data: repos } = useQuery({
    queryKey: ['repos', currentTeam?.id],
    queryFn: () => reposApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
    staleTime: STABLE_STALE_TIME,
  });
  const currentRepo = repos?.find((r) => r.slug === repoSlug);

  const { data: branches } = useQuery({
    queryKey: ['branches', currentRepo?.id],
    queryFn: () => reposApi.listBranches(currentRepo!.id),
    enabled: !!currentRepo?.id,
  });

  const branchOptions = (branches ?? []).map((b) => ({ value: b.name, label: b.name }));

  const basePath = `/${org}/${teamSlug}/repos/${repoSlug}`;

  const { mutate: createPR, isPending } = useMutation({
    mutationFn: () =>
      reposApi.createPR(currentRepo!.id, { title, body, sourceBranch, targetBranch }),
    onSuccess: (pr) => {
      toast.success('Pull request created successfully.');
      navigate(`${basePath}/pulls/${pr.number}`);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Failed to create pull request.');
    },
  });

  const sameBranch = sourceBranch && targetBranch && sourceBranch === targetBranch;
  const canSubmit = title.trim() && sourceBranch && targetBranch && !sameBranch && !isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    createPR();
  };

  return (
    <div className="max-w-2xl mx-auto">
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
          <MarkdownEditor
            value={body}
            onChange={setBody}
            placeholder="Describe your changes..."
          />
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
