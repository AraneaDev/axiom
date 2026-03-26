import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  ChevronRight,
  FolderKanban,
  Home,
  Users,
  BookOpen,
  GitBranch,
  Search,
} from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { teamsApi } from '@/api/teams.api';
import { STABLE_STALE_TIME } from '@/lib/constants';

/** Map well-known team-level route keywords to icons and friendly labels */
const SECTION_META: Record<string, { icon: React.ElementType; label: string }> = {
  repos: { icon: GitBranch, label: 'Repositories' },
  wiki: { icon: BookOpen, label: 'Wiki' },
  search: { icon: Search, label: 'Search' },
  new: { icon: FolderKanban, label: 'New' },
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

function deSlugify(seg: string) {
  return seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Breadcrumbs that resolve URL slugs to human-friendly names
 * using React Query data for orgs, teams, and projects (fetches if cache misses).
 *
 * Project routes (/:org/:team/:project/board etc.) show: Org > Team > Project
 * Issues routes (/:org/:team/:project/issues/123) show: Org > Team > Project > 123
 * Team-level routes (/:org/:team/repos/:repo) keep existing behavior.
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

  if (segments.length === 0) return null;

  // Determine whether segment[2] is a project slug vs a team-level section (repos, wiki, etc.).
  // Only treat it as a project when it is not a known SECTION_META keyword and we can confirm
  // a matching project exists in the fetched list (or the list is still loading).
  const thirdSeg = segments[2] ?? '';
  const thirdSegIsKnownSection = !!SECTION_META[thirdSeg];
  const matchedProject = projects?.find((p) => p.slug === thirdSeg);
  // While loading, tentatively treat an unknown keyword as a project so we can show skeleton.
  const isProjectRoute =
    !!thirdSeg &&
    !thirdSegIsKnownSection &&
    segments.length >= 4 &&
    (projectsLoading || !!matchedProject);

  const crumbs: Crumb[] = [];

  segments.forEach((seg, i) => {
    const path = '/' + segments.slice(0, i + 1).join('/');

    // Segment 0: org
    if (i === 0) {
      if (orgsLoading) {
        crumbs.push({ label: seg, path, icon: Building2, loading: true });
      } else {
        crumbs.push({ label: currentOrg?.name ?? deSlugify(seg), path, icon: Building2 });
      }
      return;
    }

    // Segment 1: team
    if (i === 1) {
      if (teamsLoading) {
        crumbs.push({ label: seg, path, icon: Users, loading: true });
      } else {
        crumbs.push({ label: currentTeam?.name ?? deSlugify(seg), path, icon: Users });
      }
      return;
    }

    // Segment 2: project slug or team-level section
    if (i === 2) {
      // Project routes: ProjectNavBar shows the project name, so skip segment 2+ entirely.
      if (isProjectRoute) {
        return;
      }
      // Team-level section keyword (repos, wiki, etc.)
      const meta = SECTION_META[seg];
      if (meta) {
        crumbs.push({ label: meta.label, path, icon: meta.icon });
        return;
      }
      crumbs.push({ label: deSlugify(seg), path });
      return;
    }

    // Segment 3+ on project routes: suppress all (project name is in ProjectNavBar)
    if (isProjectRoute && i >= 3) {
      return;
    }

    // Segment 3+ on team-level routes: repo name, wiki space/page, etc.
    const meta = SECTION_META[seg];
    if (meta) {
      crumbs.push({ label: meta.label, path, icon: meta.icon });
      return;
    }
    crumbs.push({ label: deSlugify(seg), path });
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
