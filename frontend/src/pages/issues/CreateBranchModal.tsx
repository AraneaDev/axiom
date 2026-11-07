import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, GitBranchPlus, Settings, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import {
  githubAccountApi,
  githubBranchApi,
  GITHUB_ACCOUNT_KEY,
  issueDevelopmentKey,
  type GithubBranchCreated,
} from '@/api/github.api';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { CopyInput } from '@/components/ui/CopyInput';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { branchNameFor, prefixOfKey, shellQuote } from '@/lib/github-branch';

interface CreateBranchModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** The issue number from the URL */
  issueNumber: string;
  issueId: string;
  issueKey: string;
  issueTitle: string;
  /** The linked repository's default branch */
  defaultBranch: string;
}

/**
 * Creates a branch named after an issue on the linked repository, as your own GitHub account.
 * The name shown is the server's own format, computed here; the server decides what is valid.
 * @param props - Modal props.
 * @param props.open - Whether the modal is shown.
 * @param props.onClose - Called to close it.
 * @param props.projectId - The issue's project.
 * @param props.issueNumber - The issue number.
 * @param props.issueId - The issue id (part of the panel's query key).
 * @param props.issueKey - The issue key, such as AXM-7.
 * @param props.issueTitle - The issue title.
 * @param props.defaultBranch - The repository's default branch.
 */
export function CreateBranchModal({
  open,
  onClose,
  projectId,
  issueNumber,
  issueId,
  issueKey,
  issueTitle,
  defaultBranch,
}: CreateBranchModalProps) {
  const queryClient = useQueryClient();
  const suggested = branchNameFor(prefixOfKey(issueKey), parseInt(issueNumber), issueTitle);
  const [name, setName] = useState(suggested);
  const [from, setFrom] = useState(defaultBranch);
  const [created, setCreated] = useState<GithubBranchCreated | null>(null);

  const account = useQuery({
    queryKey: GITHUB_ACCOUNT_KEY,
    queryFn: githubAccountApi.get,
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () =>
      githubBranchApi.create(projectId, parseInt(issueNumber), {
        name: name.trim() || undefined,
        from: from.trim() || undefined,
      }),
    onSuccess: (branch) => {
      setCreated(branch);
      queryClient.invalidateQueries({
        queryKey: issueDevelopmentKey(projectId, issueNumber, issueId),
      });
    },
  });

  // A stable callback: the Modal moves focus to its first field whenever onClose changes
  const { reset } = create;
  const handleClose = useCallback(() => {
    reset();
    setCreated(null);
    onClose();
  }, [reset, onClose]);

  let body;
  if (account.isLoading) {
    body = (
      <div className="flex justify-center p-4">
        <Spinner size="sm" />
      </div>
    );
  } else if (account.error) {
    body = <ErrorAlert error={account.error} fallback="Could not check your GitHub connection" />;
  } else if (!account.data?.connected) {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">
          A branch is created as your own GitHub account. Connect it first, then come back here.
        </p>
        <div>
          <ButtonLink to="/settings/github" variant="primary">
            <Settings className="h-4 w-4" />
            Connect GitHub
          </ButtonLink>
        </div>
      </div>
    );
  } else if (created) {
    body = (
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-sm text-text">
          <Check className="h-4 w-4 text-success" />
          Created <span className="font-mono">{created.name}</span>
        </p>
        <CopyInput
          label="switch command"
          value={`git fetch origin && git switch ${shellQuote(created.name)}`}
        />
        <div className="flex justify-end">
          <Button variant="secondary" onClick={handleClose}>
            <X className="h-4 w-4" />
            Close
          </Button>
        </div>
      </div>
    );
  } else {
    body = (
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Input
          label="Branch name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          hint={`Must contain ${issueKey}, in any case`}
        />
        <Input label="Start from" value={from} onChange={(e) => setFrom(e.target.value)} />
        {create.error && (
          <ErrorAlert error={create.error} fallback="The branch could not be created" />
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={handleClose}>
            <X className="h-4 w-4" />
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            <GitBranchPlus className="h-4 w-4" />
            Create branch
          </Button>
        </div>
      </form>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title="Create a branch">
      {body}
    </Modal>
  );
}
