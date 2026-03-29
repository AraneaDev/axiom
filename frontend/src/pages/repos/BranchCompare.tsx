import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, GitBranch } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { reposApi } from '@/api/repos.api';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageLoader } from '@/components/ui/Spinner';
import { useRepoContext } from '@/hooks/useRepoContext';

/**
 *
 */
export default function BranchCompare() {
  const { currentRepo, basePath } = useRepoContext();
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');

  const { data: branches } = useQuery({
    queryKey: ['branches', currentRepo?.id],
    queryFn: () => reposApi.listBranches(currentRepo!.id),
    enabled: !!currentRepo?.id,
  });

  // Auto-select default branch as base
  if (!base && branches && currentRepo) {
    const defaultBranch = branches.find((b) => b.isDefault);
    if (defaultBranch) setBase(defaultBranch.name);
  }

  const canCompare = !!base && !!head && base !== head && !!currentRepo;

  const { data: headCommits } = useQuery({
    queryKey: ['commits-compare-head', currentRepo?.id, head],
    queryFn: () => reposApi.listCommits(currentRepo!.id, head, 20),
    enabled: canCompare,
  });

  if (!currentRepo) return <PageLoader />;

  const branchOptions = (branches ?? []).map((b) => ({ value: b.name, label: b.name }));

  return (
    <div>
      <div className="mb-4">
        <Link
          to={basePath}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-3"
        >
          <ArrowLeft className="h-3 w-3" /> Back to repository
        </Link>
        <h1 className="text-xl font-bold">Compare branches</h1>
      </div>

      {/* Branch selectors */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <Select
            label="Base"
            options={branchOptions}
            value={base}
            onChange={(v) => setBase(v as string)}
          />
        </div>
        <ArrowRight className="h-5 w-5 text-text-secondary mt-5 shrink-0" />
        <div className="flex-1 min-w-[200px]">
          <Select
            label="Compare"
            options={branchOptions}
            value={head}
            onChange={(v) => setHead(v as string)}
          />
        </div>
      </div>

      {base === head && base && (
        <EmptyState
          icon={<GitBranch className="h-10 w-10" />}
          title="Same branch selected"
          description="Select two different branches to compare."
        />
      )}

      {canCompare && headCommits && (
        <div>
          <h2 className="text-sm font-medium mb-2">
            Commits on <Badge variant="outline">{head}</Badge> not in{' '}
            <Badge variant="outline">{base}</Badge>
          </h2>
          {headCommits.length > 0 ? (
            <Card className="divide-y divide-border">
              {headCommits.map((c) => (
                <Link
                  key={c.sha}
                  to={`${basePath}/commits/${c.sha}`}
                  className="flex items-center gap-3 px-4 py-2 hover:bg-surface-secondary transition-colors text-sm"
                >
                  <GitBranch className="h-4 w-4 text-text-secondary shrink-0" />
                  <span className="flex-1 truncate">{c.message}</span>
                  <code className="text-xs text-text-secondary font-mono">{c.shortSha}</code>
                </Link>
              ))}
            </Card>
          ) : (
            <p className="text-sm text-text-secondary text-center py-8">No differences found.</p>
          )}
        </div>
      )}

      {!canCompare && !base && (
        <EmptyState
          icon={<GitBranch className="h-10 w-10" />}
          title="Select branches"
          description="Choose a base and compare branch to see the diff."
        />
      )}
    </div>
  );
}
