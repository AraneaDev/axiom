import { useQuery } from '@tanstack/react-query';
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

import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { teamsApi } from '@/api/teams.api';
import { STABLE_STALE_TIME } from '@/lib/constants';

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
  loading?: boolean;
}

function CrumbSkeleton() {
  return <span className="inline-block h-4 w-16 bg-surface-tertiary rounded animate-pulse" />;
}

/**
 * Breadcrumbs that resolve URL slugs to human-friendly names
 * using React Query data for orgs, teams, and projects (fetches if cache misses).
 */
export function Breadcrumbs() {
  const { pathname } = useLocation();
  const params = useParams();

  const segments = pathname.split('/').filter(Boolean);

  // Fetch orgs (uses cache if available, fetches otherwise)
  const { data: orgs, isLoading: orgsLoading } = useQuery({
    queryKey: ['orgs'],
    queryFn: orgsApi.list,
    staleTime: STABLE_STALE_TIME,
    enabled: !!params.org,
  });
  const currentOrg = orgs?.find((o) => o.slug === params.org);

  const { data: teams, isLoading: teamsLoading } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id && !!params.team,
    staleTime: STABLE_STALE_TIME,
  });
  const currentTeam = teams?.find((t) => t.slug === params.team);

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects', currentTeam?.id],
    queryFn: () => projectsApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id && segments.length > 2,
    staleTime: STABLE_STALE_TIME,
  });
  const currentProject = projects?.find((p) => p.slug === segments[2]);

  if (segments.length === 0) return null;

  const crumbs: Crumb[] = segments.map((seg, i) => {
    const path = '/' + segments.slice(0, i + 1).join('/');

    // First segment: org
    if (i === 0 && params.org && seg === params.org) {
      if (orgsLoading) return { label: seg, path, icon: Building2, loading: true };
      if (currentOrg) return { label: currentOrg.name, path, icon: Building2 };
    }

    // Second segment: team
    if (i === 1 && params.team && seg === params.team) {
      if (teamsLoading) return { label: seg, path, icon: Users, loading: true };
      if (currentTeam) return { label: currentTeam.name, path, icon: Users };
    }

    // Third segment: project (for issue/board routes) or other entity
    if (i === 2 && segments.length > 3) {
      if (projectsLoading) return { label: seg, path, icon: FolderKanban, loading: true };
      if (currentProject) return { label: currentProject.name, path, icon: FolderKanban };
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
    <nav className="flex items-center gap-1 text-sm text-text-tertiary mb-4">
      <Link to="/" className="hover:text-text transition-colors">
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((crumb, i) => {
        const Icon = crumb.icon;
        const isLast = i === crumbs.length - 1;

        return (
          <span key={crumb.path} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-text-tertiary" />
            {crumb.loading ? (
              <CrumbSkeleton />
            ) : isLast ? (
              <span className="flex items-center gap-1.5 text-text font-medium">
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {crumb.label}
              </span>
            ) : (
              <Link
                to={crumb.path}
                className="flex items-center gap-1.5 hover:text-text transition-colors"
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
