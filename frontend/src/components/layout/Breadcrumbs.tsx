import { useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  ChevronRight,
  FolderKanban,
  Home,
  Users,
  BookOpen,
  GitBranch,
  LayoutList,
  Settings,
  Rocket,
  Search,
  Workflow,
  GitPullRequest,
  Tag,
} from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router';

import type { Organization, Team, Project } from '@/lib/types';

/** Map well-known route keywords to icons and friendly labels */
const SECTION_META: Record<string, { icon: React.ElementType; label: string }> = {
  issues: { icon: LayoutList, label: 'Issues' },
  repos: { icon: GitBranch, label: 'Repositories' },
  wiki: { icon: BookOpen, label: 'Wiki' },
  settings: { icon: Settings, label: 'Settings' },
  releases: { icon: Rocket, label: 'Releases' },
  search: { icon: Search, label: 'Search' },
  pipelines: { icon: Workflow, label: 'Pipelines' },
  pulls: { icon: GitPullRequest, label: 'Pull Requests' },
  tags: { icon: Tag, label: 'Tags' },
  new: { icon: FolderKanban, label: 'New' },
  board: { icon: LayoutList, label: 'Board' },
  create: { icon: FolderKanban, label: 'Create' },
};

interface Crumb {
  label: string;
  path: string;
  icon?: React.ElementType;
}

/**
 * Breadcrumbs that resolve URL slugs to human-friendly names
 * using cached React Query data for orgs, teams, and projects.
 */
export function Breadcrumbs() {
  const { pathname } = useLocation();
  const params = useParams();
  const queryClient = useQueryClient();

  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  // Look up cached data for slug-to-name resolution
  const orgs = queryClient.getQueryData<(Organization & { role: string })[]>(['orgs']);
  const currentOrg = orgs?.find((o) => o.slug === params.org);

  const teams = currentOrg ? queryClient.getQueryData<Team[]>(['teams', currentOrg.id]) : undefined;
  const currentTeam = teams?.find((t) => t.slug === params.team);

  const projects = currentTeam
    ? queryClient.getQueryData<Project[]>(['projects', currentTeam.id])
    : undefined;
  const currentProject = projects?.find((p) => p.slug === segments[2]);

  const crumbs: Crumb[] = segments.map((seg, i) => {
    const path = '/' + segments.slice(0, i + 1).join('/');

    // First segment: org
    if (i === 0 && currentOrg && seg === currentOrg.slug) {
      return { label: currentOrg.name, path, icon: Building2 };
    }

    // Second segment: team
    if (i === 1 && currentTeam && seg === currentTeam.slug) {
      return { label: currentTeam.name, path, icon: Users };
    }

    // Third segment: project (for issue/board routes) or other entity
    if (i === 2 && currentProject && seg === currentProject.slug) {
      return { label: currentProject.name, path, icon: FolderKanban };
    }

    // Known section keywords
    const meta = SECTION_META[seg];
    if (meta) {
      return { label: meta.label, path, icon: meta.icon };
    }

    // Fallback: capitalize and de-slugify
    return { label: seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), path };
  });

  return (
    <nav className="flex items-center gap-1 text-sm text-text-secondary mb-4">
      <Link to="/" className="hover:text-primary transition-colors">
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((crumb, i) => {
        const Icon = crumb.icon;
        const isLast = i === crumbs.length - 1;

        return (
          <span key={crumb.path} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-text-tertiary" />
            {isLast ? (
              <span className="flex items-center gap-1.5 text-text font-medium">
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {crumb.label}
              </span>
            ) : (
              <Link
                to={crumb.path}
                className="flex items-center gap-1.5 hover:text-primary transition-colors"
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
