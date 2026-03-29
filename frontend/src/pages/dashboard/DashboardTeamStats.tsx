import { ArrowRight, Users, GitBranch, FolderKanban } from 'lucide-react';
import { Link } from 'react-router';

import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import type { Team } from '@/lib/types';

/**
 *
 * @param root0
 * @param root0.team
 * @param root0.orgSlug
 */
export function TeamCard({
  team,
  orgSlug,
}: {
  team: Team & { _count?: { members: number; repos: number; projects: number } };
  orgSlug: string;
}) {
  return (
    <Link
      to={`/${orgSlug}/${team.slug}`}
      className="group bg-surface rounded-lg border border-border p-5 hover:border-primary/40 hover:shadow-md transition-all duration-150"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
          <Users className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-text text-sm truncate">{team.name}</h3>
          <p className="text-xs text-text-tertiary">/{team.slug}</p>
        </div>
        <ArrowRight className="h-4 w-4 text-text-tertiary opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
      </div>
      {team.description && (
        <div className="text-sm text-text-secondary line-clamp-2 mb-3">
          <MarkdownRenderer content={team.description} />
        </div>
      )}
      <div className="flex gap-4 text-xs text-text-tertiary">
        <span className="flex items-center gap-1">
          <FolderKanban className="h-3 w-3" /> {team._count?.projects ?? 0} projects
        </span>
        <span className="flex items-center gap-1">
          <GitBranch className="h-3 w-3" /> {team._count?.repos ?? 0} repos
        </span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" /> {team._count?.members ?? 0} members
        </span>
      </div>
    </Link>
  );
}
