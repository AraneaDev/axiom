import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { GitBranch, X } from 'lucide-react';
import { issuesApi } from '@/api/issues.api';
import { Button } from '@/components/ui/Button';
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

export default function CreateBranchModal({ projectId, issueNumber, repos, onClose, onCreated }: Props) {
  const [repoId, setRepoId] = useState(repos[0]?.id ?? '');
  const [branchName, setBranchName] = useState('');
  const [startPoint, setStartPoint] = useState('');
  const [error, setError] = useState('');

  const selectedRepo = repos.find(r => r.id === repoId);

  const { data: suggestion } = useQuery({
    queryKey: ['branch-suggest', projectId, issueNumber],
    queryFn: () => issuesApi.suggestBranchName(projectId, issueNumber),
  });

  useEffect(() => {
    if (suggestion?.suggestion && !branchName) setBranchName(suggestion.suggestion);
  }, [suggestion]);

  useEffect(() => {
    if (selectedRepo) setStartPoint(selectedRepo.defaultBranch);
  }, [repoId]);

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
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text p-1 rounded transition-colors"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          {repos.length > 1 && (
            <div>
              <label className="text-xs font-semibold text-text-secondary mb-1.5 block">Repository</label>
              <select
                value={repoId}
                onChange={e => setRepoId(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors"
              >
                {repos.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          )}
          <Input
            label="Branch Name"
            value={branchName}
            onChange={e => setBranchName(e.target.value)}
            placeholder="feature/..."
            className="font-mono"
          />
          <Input
            label="Start Point"
            value={startPoint}
            onChange={e => setStartPoint(e.target.value)}
            placeholder={selectedRepo?.defaultBranch ?? 'main'}
          />
          {error && (
            <p className="text-sm text-danger bg-danger-light p-2 rounded">{error}</p>
          )}
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
