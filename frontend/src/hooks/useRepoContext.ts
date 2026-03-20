import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { reposApi } from '@/api/repos.api';
import { teamsApi } from '@/api/teams.api';
import { STABLE_STALE_TIME } from '@/lib/constants';

/**
 * Resolves the current repository context from URL parameters.
 * Fetches org, team, and repo data via React Query based on route params.
 * @returns The resolved org, team, repo objects, URL slugs, and a computed basePath for links.
 */
export function useRepoContext() {
  const { org, team: teamSlug, repo: repoSlug } = useParams();

  const { data: orgs } = useQuery({
    queryKey: ['orgs'],
    queryFn: orgsApi.list,
    staleTime: STABLE_STALE_TIME,
  });
  const currentOrg = orgs?.find((o) => o.slug === org);

  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
    staleTime: STABLE_STALE_TIME,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);

  const { data: repos } = useQuery({
    queryKey: ['repos', currentTeam?.id],
    queryFn: () => reposApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
    staleTime: STABLE_STALE_TIME,
  });
  const currentRepo = repos?.find((r) => r.slug === repoSlug);

  const basePath = `/${org}/${teamSlug}/repos/${repoSlug}`;

  return { org, teamSlug, repoSlug, currentOrg, currentTeam, currentRepo, basePath };
}
