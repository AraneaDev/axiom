import { useQuery } from '@tanstack/react-query';
import {
  GitBranch,
  GitCommit,
  FileText,
  GitPullRequest,
  FolderOpen,
  Tag,
  Code,
  Workflow,
  Copy,
  Check,
  Settings,
  ChevronDown,
  BarChart3,
  Rocket,
  Loader2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';

import EnvironmentsTab from './EnvironmentsTab';
import InsightsTab from './InsightsTab';
import PipelinesTab from './PipelinesTab';
import ReleasesTab from './ReleasesTab';

import { reposApi, type CommitInfo } from '@/api/repos.api';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { RepoSkeleton } from '@/components/ui/Skeleton';
import { Tabs } from '@/components/ui/Tabs';
import { useRepoContext } from '@/hooks/useRepoContext';
import { formatRelative } from '@/lib/utils';

/**
 *
 */
export default function RepoDetail() {
  const { org, team: teamSlug, repo: repoSlug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const { currentRepo, basePath } = useRepoContext();

  const TAB_SLUGS = ['branches', 'commits', 'releases', 'pipelines', 'environments', 'insights'];
  const pathParts = location.pathname.split('/');
  const lastSegment = pathParts[pathParts.length - 1];
  const activeTab = TAB_SLUGS.includes(lastSegment) ? lastSegment : 'code';

  const activeBranch = selectedBranch ?? currentRepo?.defaultBranch ?? 'main';

  const { data: branches } = useQuery({
    queryKey: ['branches', currentRepo?.id],
    queryFn: () => reposApi.listBranches(currentRepo!.id),
    enabled: !!currentRepo?.id,
  });

  const { data: tree } = useQuery({
    queryKey: ['tree', currentRepo?.id, activeBranch],
    queryFn: () => reposApi.getTree(currentRepo!.id, activeBranch),
    enabled: !!currentRepo?.id,
  });

  const COMMITS_PAGE_SIZE = 30;
  const [extraCommits, setExtraCommits] = useState<CommitInfo[]>([]);
  const [hasMoreCommits, setHasMoreCommits] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [commitsSkip, setCommitsSkip] = useState(COMMITS_PAGE_SIZE);

  const { data: commits } = useQuery({
    queryKey: ['commits', currentRepo?.id, activeBranch],
    queryFn: () => reposApi.listCommits(currentRepo!.id, activeBranch, COMMITS_PAGE_SIZE),
    enabled: !!currentRepo?.id,
  });

  // Reset extra commits when branch changes
  useEffect(() => {
    setExtraCommits([]);
    setCommitsSkip(COMMITS_PAGE_SIZE);
    setHasMoreCommits(true);
  }, [activeBranch]);

  const allCommits = commits ? [...commits, ...extraCommits] : [];
  const commitsHasMore = commits ? commits.length >= COMMITS_PAGE_SIZE && hasMoreCommits : false;

  const loadMoreCommits = useCallback(async () => {
    if (!currentRepo?.id || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await reposApi.listCommits(
        currentRepo.id,
        activeBranch,
        COMMITS_PAGE_SIZE,
        commitsSkip,
      );
      setExtraCommits((prev) => [...prev, ...more]);
      setCommitsSkip((prev) => prev + COMMITS_PAGE_SIZE);
      setHasMoreCommits(more.length >= COMMITS_PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }, [currentRepo?.id, activeBranch, commitsSkip, loadingMore]);

  const { data: prs } = useQuery({
    queryKey: ['prs', currentRepo?.id],
    queryFn: () => reposApi.listPRs(currentRepo!.id, 'OPEN'),
    enabled: !!currentRepo?.id,
  });

  // Find README in tree and fetch its content
  const readmeEntry = tree?.find((e) => /^readme\.md$/i.test(e.name));
  const { data: readmeBlob } = useQuery({
    queryKey: ['blob', currentRepo?.id, activeBranch, readmeEntry?.name],
    queryFn: () => reposApi.getBlob(currentRepo!.id, activeBranch, readmeEntry!.name),
    enabled: !!currentRepo?.id && !!readmeEntry,
  });

  const [cloneCopied, setCloneCopied] = useState<'http' | 'ssh' | null>(null);

  if (!currentRepo) return <RepoSkeleton />;
  const httpCloneUrl = `${window.location.origin}/git/${org}/${teamSlug}/${repoSlug}.git`;
  const sshCloneUrl = `git@${window.location.hostname}:${org}/${teamSlug}/${repoSlug}.git`;

  const tabs = [
    { key: 'code', label: 'Files', icon: <FolderOpen className="h-4 w-4" /> },
    {
      key: 'branches',
      label: `Branches (${branches?.length ?? 0})`,
      icon: <GitBranch className="h-4 w-4" />,
    },
    {
      key: 'prs',
      label: `PRs (${prs?.length ?? 0})`,
      icon: <GitPullRequest className="h-4 w-4" />,
    },
    { key: 'commits', label: 'Commits', icon: <GitCommit className="h-4 w-4" /> },
    { key: 'releases', label: 'Releases', icon: <Tag className="h-4 w-4" /> },
    { key: 'pipelines', label: 'Pipelines', icon: <Workflow className="h-4 w-4" /> },
    { key: 'environments', label: 'Environments', icon: <Rocket className="h-4 w-4" /> },
    { key: 'insights', label: 'Insights', icon: <BarChart3 className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">{currentRepo.name}</h1>
          {currentRepo.description && (
            <p className="text-sm text-text-secondary mt-1">{currentRepo.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/${org}/${teamSlug}/repos/${repoSlug}/pulls/new`}>
            <Button variant="primary" size="sm">
              <GitPullRequest className="h-4 w-4" /> New Pull Request
            </Button>
          </Link>
          <Dropdown
            trigger={
              <Button variant="secondary" size="sm">
                <Code className="h-4 w-4" /> Clone <ChevronDown className="h-3 w-3" />
              </Button>
            }
          >
            <div className="p-3 min-w-[340px] space-y-3">
              <div>
                <p className="text-xs font-medium text-text-secondary mb-1.5">HTTP</p>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={httpCloneUrl}
                    aria-label="HTTP clone URL"
                    className="flex-1 text-xs font-mono bg-surface-secondary border border-border rounded px-2 py-1.5"
                  />
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      navigator.clipboard.writeText(httpCloneUrl);
                      setCloneCopied('http');
                      setTimeout(() => setCloneCopied(null), 2000);
                    }}
                    title="Copy HTTP URL"
                    aria-label="Copy HTTP URL"
                  >
                    {cloneCopied === 'http' ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-text-secondary mb-1.5">SSH</p>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={sshCloneUrl}
                    aria-label="SSH clone URL"
                    className="flex-1 text-xs font-mono bg-surface-secondary border border-border rounded px-2 py-1.5"
                  />
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      navigator.clipboard.writeText(sshCloneUrl);
                      setCloneCopied('ssh');
                      setTimeout(() => setCloneCopied(null), 2000);
                    }}
                    title="Copy SSH URL"
                    aria-label="Copy SSH URL"
                  >
                    {cloneCopied === 'ssh' ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </Dropdown>
          <Link to={`${basePath}/settings`}>
            <Button
              variant="ghost"
              size="sm"
              title="Repository settings"
              aria-label="Repository settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex gap-3 text-sm text-text-secondary border-b border-border pb-4">
        <span className="flex items-center gap-1.5">
          <GitBranch className="h-4 w-4 text-text-tertiary" /> {branches?.length ?? 0} branches
        </span>
        <span className="flex items-center gap-1.5">
          <Tag className="h-4 w-4 text-text-tertiary" /> {currentRepo.defaultBranch}
        </span>
        <span className="flex items-center gap-1.5">
          <GitPullRequest className="h-4 w-4 text-text-tertiary" /> {prs?.length ?? 0} open PRs
        </span>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={tabs}
        activeKey={activeTab}
        onChange={(tab) => {
          if (tab === 'prs') {
            navigate(`${basePath}/pulls`);
          } else if (tab === 'code') {
            navigate(basePath);
          } else {
            navigate(`${basePath}/${tab}`);
          }
        }}
      />

      {/* Code tab */}
      {activeTab === 'code' && (
        <>
          {/* Branch switcher */}
          <div className="flex items-center gap-3">
            <Dropdown
              trigger={
                <Button variant="secondary" size="sm">
                  <GitBranch className="h-4 w-4" /> {activeBranch}{' '}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              }
            >
              <div className="max-h-64 overflow-y-auto py-1">
                {branches?.map((branch) => (
                  <DropdownItem
                    key={branch.name}
                    onClick={() => setSelectedBranch(branch.name)}
                    className={
                      branch.name === activeBranch ? 'bg-surface-tertiary font-medium' : ''
                    }
                  >
                    <GitBranch className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{branch.name}</span>
                    {branch.name === currentRepo.defaultBranch && (
                      <Badge variant="primary" size="sm" className="ml-auto">
                        default
                      </Badge>
                    )}
                  </DropdownItem>
                ))}
              </div>
            </Dropdown>
          </div>

          {tree && (
            <div className="rounded-lg border border-border bg-surface divide-y divide-border">
              {tree
                .sort((a, b) =>
                  a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'tree' ? -1 : 1,
                )
                .map((entry) => (
                  <Link
                    key={entry.sha + entry.name}
                    to={
                      entry.type === 'tree'
                        ? `${basePath}/tree/${activeBranch}/${entry.name}`
                        : `${basePath}/blob/${activeBranch}/${entry.name}`
                    }
                    className="flex items-center gap-3 px-4 py-2 hover:bg-surface-secondary transition-colors"
                  >
                    {entry.type === 'tree' ? (
                      <FolderOpen className="h-4 w-4 text-primary" />
                    ) : (
                      <FileText className="h-4 w-4 text-text-secondary" />
                    )}
                    <span className="text-sm">{entry.name}</span>
                    {entry.size !== undefined && (
                      <span className="ml-auto text-xs text-text-secondary">
                        {(entry.size / 1024).toFixed(1)} KB
                      </span>
                    )}
                  </Link>
                ))}
            </div>
          )}
        </>
      )}

      {/* README */}
      {activeTab === 'code' && readmeBlob?.content && (
        <div className="rounded-lg border border-border bg-surface p-6">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
            <FileText className="h-4 w-4 text-text-tertiary" />
            <span className="text-sm font-medium text-text-secondary">{readmeEntry?.name}</span>
          </div>
          <div className="prose max-w-none">
            <MarkdownRenderer content={readmeBlob.content} />
          </div>
        </div>
      )}

      {/* Branches tab */}
      {activeTab === 'branches' && branches && (
        <div className="rounded-lg border border-border bg-surface divide-y divide-border">
          {branches.map((branch) => (
            <div key={branch.name} className="flex items-center gap-3 px-4 py-3">
              <GitBranch className="h-4 w-4 text-text-secondary shrink-0" />
              <span className="text-sm font-medium flex-1">{branch.name}</span>
              {branch.name === currentRepo.defaultBranch && (
                <Badge variant="primary" size="sm">
                  default
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}

      {/* PRs tab */}
      {activeTab === 'prs' && (
        <div>
          {prs && prs.length > 0 ? (
            <div className="rounded-lg border border-border bg-surface divide-y divide-border">
              {prs.map((pr) => (
                <Link
                  key={pr.id}
                  to={`${basePath}/pulls/${pr.number}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-secondary transition-colors"
                >
                  <GitPullRequest className="h-4 w-4 text-success shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{pr.title}</p>
                    <p className="text-xs text-text-secondary">
                      #{pr.number} &middot; {pr.sourceBranch} &rarr; {pr.targetBranch}
                    </p>
                  </div>
                  <Badge variant="outline" size="sm">
                    {pr.status}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-secondary text-center py-8">No open pull requests.</p>
          )}
        </div>
      )}

      {/* Pipelines tab */}
      {activeTab === 'pipelines' && currentRepo && <PipelinesTab repoId={currentRepo.id} />}

      {/* Releases tab */}
      {activeTab === 'releases' && currentRepo && (
        <ReleasesTab
          repoId={currentRepo.id}
          defaultBranch={currentRepo.defaultBranch}
          orgSlug={org!}
          teamSlug={teamSlug!}
          repoSlug={repoSlug!}
        />
      )}

      {/* Environments tab */}
      {activeTab === 'environments' && currentRepo && <EnvironmentsTab repoId={currentRepo.id} />}

      {/* Insights tab */}
      {activeTab === 'insights' && currentRepo && <InsightsTab repoId={currentRepo.id} />}

      {/* Commits tab */}
      {activeTab === 'commits' && (
        <div>
          {allCommits.length > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <GitCommit className="h-4 w-4 text-text-tertiary" />
              <span className="text-sm text-text-secondary font-medium">
                {allCommits.length}
                {commitsHasMore ? '+' : ''} commits on {activeBranch}
              </span>
            </div>
          )}
          {allCommits.length > 0 ? (
            <div className="rounded-lg border border-border bg-surface divide-y divide-border">
              {allCommits.map((c) => (
                <Link
                  key={c.sha}
                  to={`${basePath}/commits/${c.sha}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-secondary transition-colors"
                >
                  <GitCommit className="h-4 w-4 text-text-tertiary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.message}</p>
                    <p className="text-xs text-text-tertiary">
                      {c.author} &middot; {formatRelative(c.date)}
                    </p>
                  </div>
                  <code className="text-xs text-text-tertiary font-mono bg-surface-secondary px-1.5 py-0.5 rounded">
                    {c.shortSha}
                  </code>
                </Link>
              ))}
            </div>
          ) : (
            commits && (
              <p className="text-sm text-text-secondary text-center py-8">No commits found.</p>
            )
          )}
          {commitsHasMore && allCommits.length > 0 && (
            <div className="flex justify-center mt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={loadMoreCommits}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <GitCommit className="h-4 w-4" />
                )}
                {loadingMore ? 'Loading...' : 'Load more commits'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
