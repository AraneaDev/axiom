import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  Building2,
  ChevronRight,
  FolderKanban,
  Home,
  LayoutDashboard,
  Users,
  BookOpen,
  Search,
} from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { teamsApi } from '@/api/teams.api';
import { Skeleton } from '@/components/ui/Skeleton';
import { STABLE_STALE_TIME } from '@/lib/constants';

/** Map well-known team-level route keywords to icons and friendly labels */
const SECTION_META: Record<string, { icon: React.ElementType; label: string }> = {
  wiki: { icon: BookOpen, label: 'Wiki' },
  search: { icon: Search, label: 'Search' },
  new: { icon: FolderKanban, label: 'New' },
  create: { icon: FolderKanban, label: 'Create' },
};

/**
 * Project-level view segments that should NOT appear as breadcrumbs.
 * The ProjectNavBar handles indicating which view is active.
 */
const PROJECT_VIEW_SEGMENTS = new Set([
  'board',
  'issues',
  'backlog',
  'roadmap',
  'milestones',
  'analytics',
  'time-report',
  'settings',
]);

interface Crumb {
  label: string;
  path: string;
  icon?: React.ElementType;
  loading?: boolean;
}

function CrumbSkeleton() {
  return <Skeleton className="inline-block h-4 w-16" />;
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
 * Team-level routes (/:org/:team/wiki/:space) keep existing behavior.
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

  // Determine whether segment[2] is a project slug vs a team-level section (wiki, etc.).
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

  // Project breadcrumb always links to the board view.
  const projectBreadcrumbPath =
    segments.length >= 3 ? `/${segments[0]}/${segments[1]}/${thirdSeg}/board` : '';

  const crumbs: Crumb[] = [];
  // Not an org and a team either: the list, and a request below it that the page itself names
  const isAgentApprovalRoute = segments[0] === 'approvals' && segments[1] === 'agent';
  if (isAgentApprovalRoute) {
    crumbs.push({ label: 'Agent approvals', path: '/approvals/agent', icon: Bot });
    if (segments[2]) crumbs.push({ label: 'Request', path: pathname });
  }
  // Not an org and a team: the id below it says nothing, and the page names the dashboard itself
  const isDashboardRoute = segments[0] === 'dashboards' && !params.org;
  if (isDashboardRoute) {
    crumbs.push({ label: 'Dashboards', path: '/dashboards', icon: LayoutDashboard });
  }

  (isDashboardRoute || isAgentApprovalRoute ? [] : segments).forEach((seg, i) => {
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
      if (isProjectRoute) {
        if (projectsLoading) {
          crumbs.push({
            label: seg,
            path: projectBreadcrumbPath,
            icon: FolderKanban,
            loading: true,
          });
        } else {
          crumbs.push({
            label: matchedProject?.name ?? deSlugify(seg),
            path: projectBreadcrumbPath,
            icon: FolderKanban,
          });
        }
        return;
      }
      // Team-level section keyword (wiki, etc.)
      const meta = SECTION_META[seg];
      if (meta) {
        crumbs.push({ label: meta.label, path, icon: meta.icon });
        return;
      }
      crumbs.push({ label: deSlugify(seg), path });
      return;
    }

    // Segment 3 on project routes: the view name (board, issues, backlog, …) — suppress it.
    if (isProjectRoute && i === 3 && PROJECT_VIEW_SEGMENTS.has(seg)) {
      return;
    }

    // Segment 4+ on project routes: sub-resources like issue numbers
    if (isProjectRoute && i >= 4) {
      crumbs.push({ label: deSlugify(seg), path });
      return;
    }

    // Segment 3+ on team-level routes: wiki space/page, etc.
    const meta = SECTION_META[seg];
    if (meta) {
      crumbs.push({ label: meta.label, path, icon: meta.icon });
      return;
    }

    crumbs.push({ label: deSlugify(decodeURIComponent(seg)), path });
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
