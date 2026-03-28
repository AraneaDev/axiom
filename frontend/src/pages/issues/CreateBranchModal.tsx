import { useQuery, useMutation } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';
import { useState, useEffect } from 'react';

import { issuesApi } from '@/api/issues.api';
import { Select } from '@/components/ui/Dropdown';
import { FormModal } from '@/components/ui/FormModal';
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
    <FormModal
      open={true}
      onClose={onClose}
      title="Create Branch"
      size="md"
      onSubmit={() => mutation.mutate()}
      isPending={mutation.isPending}
      error={error}
      submitLabel="Create Branch"
      submitIcon={<GitBranch className="h-4 w-4" />}
      disabled={!branchName}
    >
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
    </FormModal>
  );
}
