import { useQuery, useMutation } from '@tanstack/react-query';
import { GitBranch, X } from 'lucide-react';
import { useState, useEffect } from 'react';

import { issuesApi } from '@/api/issues.api';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';

interface Repo {
  id: string;
  name: string;
  slug: string;
  defaultBranch: string;
}

interface Props {
  projectId: string;
  issueNumber: number;
  teamId: string;
  repos: Repo[];
  onClose: () => void;
  onCreated: (branch: { branchName: string; repo: { slug: string } }) => void;
}

/**
 *
 * @param root0
 * @param root0.projectId
 * @param root0.issueNumber
 * @param root0.repos
 * @param root0.onClose
 * @param root0.onCreated
 */
export default function CreateBranchModal({
  projectId,
  issueNumber,
  repos,
  onClose,
  onCreated,
}: Props) {
  const [repoId, setRepoId] = useState(repos[0]?.id ?? '');
  const [branchName, setBranchName] = useState('');
  const [startPoint, setStartPoint] = useState('');
  const [error, setError] = useState('');

  const selectedRepo = repos.find((r) => r.id === repoId);

  const { data: suggestion } = useQuery({
    queryKey: ['branch-suggest', projectId, issueNumber],
    queryFn: () => issuesApi.suggestBranchName(projectId, issueNumber),
  });

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- sync derived state */
  useEffect(() => {
    if (suggestion?.suggestion && !branchName) setBranchName(suggestion.suggestion);
  }, [suggestion]);

  useEffect(() => {
    if (selectedRepo) setStartPoint(selectedRepo.defaultBranch);
  }, [repoId]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const mutation = useMutation({
    mutationFn: () =>
      issuesApi.createIssueBranch(projectId, issueNumber, {
        repoId,
        branchName,
        startPoint: startPoint || undefined,
      }),
    onSuccess: (branch) => onCreated(branch),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to create branch'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-elevated rounded-xl border border-border shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold flex items-center gap-2">
            <GitBranch className="h-4 w-4" /> Create Branch
          </h2>
          <Button variant="ghost" size="xs" onClick={onClose} title="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-4 space-y-4">
          {repos.length > 1 && (
            <Select
              label="Repository"
              value={repoId}
              onChange={(v) => setRepoId(v as string)}
              options={repos.map((r) => ({ value: r.id, label: r.name }))}
            />
          )}
          <Input
            label="Branch Name"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder="feature/..."
            className="font-mono"
          />
          <Input
            label="Start Point"
            value={startPoint}
            onChange={(e) => setStartPoint(e.target.value)}
            placeholder={selectedRepo?.defaultBranch ?? 'main'}
          />
          {error && <p className="text-sm text-danger bg-danger-light p-2 rounded">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-border">
          <Button variant="secondary" onClick={onClose}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!branchName || mutation.isPending}>
            <GitBranch className="h-4 w-4" /> {mutation.isPending ? 'Creating...' : 'Create Branch'}
          </Button>
        </div>
      </div>
    </div>
  );
}
