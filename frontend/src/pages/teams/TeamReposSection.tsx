import { GitBranch, Plus, ArrowRight } from 'lucide-react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';

interface Repo {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  visibility: string;
  defaultBranch: string;
}

interface TeamReposSectionProps {
  repos: Repo[] | undefined;
  orgSlug: string | undefined;
  teamSlug: string | undefined;
}

/**
 *
 * @param root0
 * @param root0.repos
 * @param root0.orgSlug
 * @param root0.teamSlug
 */
export function TeamReposSection({ repos, orgSlug, teamSlug }: TeamReposSectionProps) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-primary" />
          <h2 className="h3">Repositories</h2>
        </div>
        <Link to={`/${orgSlug}/${teamSlug}/repos/new`}>
          <Button variant="ghost" size="sm">
            <Plus className="h-4 w-4" /> New Repo
          </Button>
        </Link>
      </div>
      {!repos?.length ? (
        <EmptyState
          icon={<GitBranch className="h-10 w-10" />}
          title="No repositories yet"
          description="Create a repository to start hosting code."
        />
      ) : (
        <div className="space-y-2">
          {repos.map((r) => (
            <Link
              key={r.id}
              to={`/${orgSlug}/${teamSlug}/repos/${r.slug}`}
              className="group bg-surface flex items-center gap-3 rounded-lg border border-border px-4 py-3 hover:border-primary/50 hover:shadow-sm transition-all"
            >
              <GitBranch className="h-4 w-4 text-text-secondary shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-medium text-text">{r.name}</span>
                {r.description && (
                  <p className="text-xs text-text-tertiary line-clamp-1 mt-0.5">{r.description}</p>
                )}
              </div>
              <Badge
                variant="outline"
                size="sm"
                className={cn(
                  r.visibility === 'PUBLIC' && 'text-success border-success/30',
                  r.visibility === 'PRIVATE' && 'text-text-tertiary',
                )}
              >
                {r.visibility.toLowerCase()}
              </Badge>
              <span className="text-xs text-text-tertiary">{r.defaultBranch}</span>
              <ArrowRight className="h-3.5 w-3.5 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
