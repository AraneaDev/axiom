import type { CommitInfo } from '@/api/repos.api';
import { Card } from '@/components/ui/Card';

interface CommitListProps {
  commits: CommitInfo[];
}

/**
 *
 * @param root0
 * @param root0.commits
 */
/**
 *
 * @param root0
 * @param root0.commits
 */
export function CommitList({ commits }: CommitListProps) {
  if (commits.length === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-semibold mb-2">Commits ({commits.length})</h2>
      <Card className="divide-y divide-border">
        {commits.map((c: CommitInfo) => (
          <div key={c.sha} className="flex items-center gap-3 px-4 py-2">
            <code className="text-xs text-text-secondary font-mono">{c.shortSha}</code>
            <span className="text-sm flex-1 truncate">{c.message}</span>
            <span className="text-xs text-text-secondary">{c.author}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
