import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  Plus,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader,
  Workflow,
  FileText,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { developmentPanelApi } from '@/api/development-panel.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';

import CreateBranchModal from './CreateBranchModal';

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

const PIPELINE_STATUS_ICON: Record<string, { icon: typeof CheckCircle2; className: string }> = {
  passed: { icon: CheckCircle2, className: 'text-success' },
  success: { icon: CheckCircle2, className: 'text-success' },
  failed: { icon: XCircle, className: 'text-destructive' },
  running: { icon: Loader, className: 'text-warning' },
  pending: { icon: Loader, className: 'text-warning' },
};

/**
 *
 * @param root0
 * @param root0.projectId
 * @param root0.issueNumber
 * @param root0.org
 * @param root0.teamSlug
 * @param root0.repos
 */
export default function IssueDevelopmentCard({
  projectId,
  issueNumber,
  org,
  teamSlug,
  repos,
}: Props) {
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    branches: true,
    prs: true,
    commits: false,
    pipelines: false,
  });
  const qc = useQueryClient();

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const { data, isLoading } = useQuery({
    queryKey: ['development-panel', projectId, issueNumber],
    queryFn: () => developmentPanelApi.getSummary(projectId, issueNumber),
  });

  const branches = data?.branches ?? [];
  const prs = data?.pullRequests ?? [];
  const commits = data?.commits ?? [];
  const pipelines = data?.pipelines ?? [];
  const wikiPages = data?.wikiPages ?? [];

  const hasDev =
    branches.length + prs.length + commits.length + pipelines.length + wikiPages.length > 0;

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <GitBranch className="h-4 w-4 text-text-secondary" />
        <h3 className="text-sm font-semibold">Development</h3>
        {isLoading && <Spinner className="h-3.5 w-3.5" />}
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
              <Link
                key={b.id}
                to={`/${org}/${teamSlug}/repos/${b.repoSlug}/tree/${b.branchName}`}
                className="flex items-center gap-2 text-xs py-0.5 hover:bg-surface-secondary rounded px-1 -mx-1 transition-colors"
              >
                <GitBranch className="h-3 w-3 text-text-tertiary flex-shrink-0" />
                <span className="font-mono text-primary truncate">{b.branchName}</span>
                <span className="text-text-tertiary ml-auto flex-shrink-0">{b.repoName}</span>
              </Link>
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
                <Link
                  key={p.id}
                  to={`/${org}/${teamSlug}/repos/${p.repoSlug}/pulls/${p.number}`}
                  className="flex items-center gap-2 text-xs py-0.5 hover:bg-surface-secondary rounded px-1 -mx-1 transition-colors"
                >
                  <GitPullRequest className="h-3 w-3 text-text-tertiary flex-shrink-0" />
                  <span className="text-primary truncate flex-1">{p.title}</span>
                  <span
                    className={cn(
                      'px-1.5 py-0.5 rounded-full border text-[10px]',
                      PR_STATUS_COLORS[p.status] ?? '',
                    )}
                  >
                    {p.status}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Commits */}
      {commits.length > 0 && (
        <div className="mb-2">
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
                <Link
                  key={c.id}
                  to={`/${org}/${teamSlug}/repos/${c.repoSlug}/commit/${c.sha}`}
                  className="flex items-center gap-2 text-xs py-0.5 hover:bg-surface-secondary rounded px-1 -mx-1 transition-colors"
                >
                  <GitCommit className="h-3 w-3 text-text-tertiary flex-shrink-0" />
                  <code className="text-primary flex-shrink-0">{c.sha.slice(0, 7)}</code>
                  <span className="text-text truncate flex-1">
                    {c.message.split('\n')[0].slice(0, 60)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pipelines */}
      {pipelines.length > 0 && (
        <div>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => toggle('pipelines')}
            className="flex items-center gap-1 text-xs font-semibold text-text-secondary mb-1.5 w-full hover:text-text"
          >
            {expanded.pipelines ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Pipelines <span className="ml-auto text-text-tertiary">{pipelines.length}</span>
          </Button>
          {expanded.pipelines && (
            <div className="space-y-1">
              {pipelines.map((p) => {
                const statusKey = p.status.toLowerCase();
                const statusConfig = PIPELINE_STATUS_ICON[statusKey] ?? {
                  icon: Loader,
                  className: 'text-text-tertiary',
                };
                const StatusIcon = statusConfig.icon;
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 text-xs py-0.5 rounded px-1 -mx-1"
                  >
                    <Workflow className="h-3 w-3 text-text-tertiary flex-shrink-0" />
                    <span className="text-text truncate flex-1">{p.pipelineName}</span>
                    <StatusIcon className={cn('h-3 w-3 flex-shrink-0', statusConfig.className)} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Wiki Pages */}
      {wikiPages.length > 0 && (
        <div className="mb-2">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => toggle('wikiPages')}
            className="flex items-center gap-1 text-xs font-semibold text-text-secondary mb-1.5 w-full hover:text-text"
          >
            {expanded.wikiPages ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Wiki Pages <span className="ml-auto text-text-tertiary">{wikiPages.length}</span>
          </Button>
          {expanded.wikiPages && (
            <div className="space-y-1">
              {wikiPages.map((w) => (
                <Link
                  key={w.id}
                  to={`/${w.page.space.team.org.slug}/${w.page.space.team.slug}/wiki/${w.page.space.slug}/${w.page.slug}`}
                  className="flex items-center gap-2 text-xs py-0.5 hover:bg-surface-secondary rounded px-1 -mx-1 transition-colors"
                >
                  <FileText className="h-3 w-3 text-text-tertiary flex-shrink-0" />
                  <span className="text-primary truncate flex-1">{w.page.title}</span>
                  <span className="text-text-tertiary ml-auto flex-shrink-0">
                    {w.page.space.name}
                  </span>
                </Link>
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
            qc.invalidateQueries({ queryKey: ['development-panel', projectId, issueNumber] });
            setShowBranchModal(false);
          }}
        />
      )}
    </Card>
  );
}
