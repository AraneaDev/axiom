import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { reposApi } from '@/api/repos.api';
import { teamsApi } from '@/api/teams.api';

/**
 *
 */
export function useRepoContext() {
  const { org, team: teamSlug, repo: repoSlug } = useParams();

  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);

  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);

  const { data: repos } = useQuery({
    queryKey: ['repos', currentTeam?.id],
    queryFn: () => reposApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });
  const currentRepo = repos?.find((r) => r.slug === repoSlug);

  const basePath = `/${org}/${teamSlug}/repos/${repoSlug}`;

  return { org, teamSlug, repoSlug, currentOrg, currentTeam, currentRepo, basePath };
}
