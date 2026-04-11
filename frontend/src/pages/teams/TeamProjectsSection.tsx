import { FolderKanban, Plus, ArrowRight } from 'lucide-react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

interface Project {
  id: string;
  name: string;
  slug: string;
  prefix: string;
  description?: string | null;
  _count?: { issues?: number };
}

interface TeamProjectsSectionProps {
  projects: Project[] | undefined;
  orgSlug: string | undefined;
  teamSlug: string | undefined;
}

/**
 *
 * @param root0
 * @param root0.projects
 * @param root0.orgSlug
 * @param root0.teamSlug
 */
export function TeamProjectsSection({ projects, orgSlug, teamSlug }: TeamProjectsSectionProps) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-5 w-5 text-primary" />
          <h2 className="h3">Projects</h2>
        </div>
        <Link to={`/${orgSlug}/${teamSlug}/projects/new`}>
          <Button variant="ghost" size="sm">
            <Plus className="h-4 w-4" /> New Project
          </Button>
        </Link>
      </div>
      {!projects?.length ? (
        <EmptyState
          icon={<FolderKanban className="h-10 w-10" />}
          title="No projects yet"
          description="Create a project to start tracking issues."
        />
      ) : (
        <div className="space-y-2">
          {projects.map((p) => (
            <Link
              key={p.id}
              to={`/${orgSlug}/${teamSlug}/${p.slug}/board`}
              className="group bg-surface flex items-center gap-4 rounded-lg border border-border p-4 hover:border-primary/50 hover:shadow-sm transition-all"
            >
              <div className="h-10 w-10 rounded-lg bg-primary-light flex items-center justify-center shrink-0">
                <FolderKanban className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-semibold text-text">{p.name}</span>
                  <Badge variant="outline" size="sm">
                    {p.prefix}
                  </Badge>
                </div>
                {p.description && (
                  <p className="text-sm text-text-secondary line-clamp-1">{p.description}</p>
                )}
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-center">
                  <p className="text-lg font-bold text-text">{p._count?.issues ?? 0}</p>
                  <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Issues</p>
                </div>
                <ArrowRight className="h-4 w-4 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
