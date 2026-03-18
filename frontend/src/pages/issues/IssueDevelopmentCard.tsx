import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  Plus,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';

import CreateBranchModal from './CreateBranchModal';

import { issuesApi } from '@/api/issues.api';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface Repo {
  id: string;
  name: string;
  slug: string;
  defaultBranch: string;
}

interface Props {
  projectId: string;
  issueNumber: number;
  issueId: string;
  org: string;
  teamSlug: string;
  repos: Repo[];
}

const PR_STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-success/10 text-success border-success/20',
  MERGED: 'bg-primary/10 text-primary border-primary/20',
  CLOSED: 'bg-danger/10 text-danger border-danger/20',
};

/**
 *
 * @param root0
 * @param root0.projectId
 * @param root0.issueNumber
 * @param root0.repos
 */
export default function IssueDevelopmentCard({ projectId, issueNumber, repos }: Props) {
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    branches: true,
    prs: true,
    commits: false,
  });
  const qc = useQueryClient();

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const { data: branches = [] } = useQuery({
    queryKey: ['issue-branches', projectId, issueNumber],
    queryFn: () => issuesApi.listIssueBranches(projectId, issueNumber),
  });

  const { data: prs = [] } = useQuery({
    queryKey: ['issue-prs', projectId, issueNumber],
    queryFn: () => issuesApi.listIssuePRs(projectId, issueNumber),
  });

  const { data: commits = [] } = useQuery({
    queryKey: ['issue-commits', projectId, issueNumber],
    queryFn: () => issuesApi.listIssueCommits(projectId, issueNumber),
  });

  const hasDev = branches.length + prs.length + commits.length > 0;

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <GitBranch className="h-4 w-4 text-text-secondary" />
        <h3 className="text-sm font-semibold">Development</h3>
      </div>

      {/* Branches */}
      <div className="mb-2">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => toggle('branches')}
          className="flex items-center gap-1 text-xs font-semibold text-text-secondary mb-1.5 w-full hover:text-text"
        >
          {expanded.branches ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Branches
          {branches.length > 0 && (
            <span className="ml-auto text-text-tertiary">{branches.length}</span>
          )}
        </Button>
        {expanded.branches && (
          <div className="space-y-1">
            {branches.map((b) => (
              <div key={b.id} className="flex items-center gap-2 text-xs py-0.5">
                <GitBranch className="h-3 w-3 text-text-tertiary flex-shrink-0" />
                <span className="font-mono text-text truncate">{b.branchName}</span>
                <span className="text-text-tertiary ml-auto flex-shrink-0">{b.repo.name}</span>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs mt-1"
              onClick={() => setShowBranchModal(true)}
            >
              <Plus className="h-3 w-3" /> Create Branch
            </Button>
          </div>
        )}
        {!expanded.branches && branches.length === 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => setShowBranchModal(true)}
          >
            <Plus className="h-3 w-3" /> Create Branch
          </Button>
        )}
      </div>

      {/* Pull Requests */}
      {prs.length > 0 && (
        <div className="mb-2">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => toggle('prs')}
            className="flex items-center gap-1 text-xs font-semibold text-text-secondary mb-1.5 w-full hover:text-text"
          >
            {expanded.prs ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Pull Requests <span className="ml-auto text-text-tertiary">{prs.length}</span>
          </Button>
          {expanded.prs && (
            <div className="space-y-1">
              {prs.map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-xs py-0.5">
                  <GitPullRequest className="h-3 w-3 text-text-tertiary flex-shrink-0" />
                  <span className="text-text truncate flex-1">{p.pr.title}</span>
                  <span
                    className={cn(
                      'px-1.5 py-0.5 rounded-full border text-[10px]',
                      PR_STATUS_COLORS[p.pr.status] ?? '',
                    )}
                  >
                    {p.pr.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Commits */}
      {commits.length > 0 && (
        <div>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => toggle('commits')}
            className="flex items-center gap-1 text-xs font-semibold text-text-secondary mb-1.5 w-full hover:text-text"
          >
            {expanded.commits ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Commits <span className="ml-auto text-text-tertiary">{commits.length}</span>
          </Button>
          {expanded.commits && (
            <div className="space-y-1">
              {commits.slice(0, 5).map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-xs py-0.5">
                  <GitCommit className="h-3 w-3 text-text-tertiary flex-shrink-0" />
                  <code className="text-text-tertiary flex-shrink-0">{c.sha.slice(0, 7)}</code>
                  <span className="text-text truncate flex-1">
                    {c.message.split('\n')[0].slice(0, 60)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!hasDev && <p className="text-xs text-text-tertiary">No branches, commits, or PRs yet.</p>}

      {showBranchModal && repos.length > 0 && (
        <CreateBranchModal
          projectId={projectId}
          issueNumber={issueNumber}
          teamId=""
          repos={repos}
          onClose={() => setShowBranchModal(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['issue-branches', projectId, issueNumber] });
            setShowBranchModal(false);
          }}
        />
      )}
    </div>
  );
}
