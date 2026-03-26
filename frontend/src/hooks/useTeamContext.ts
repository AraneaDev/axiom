import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { STABLE_STALE_TIME } from '@/lib/constants';

export function useTeamContext() {
  const { org, team: teamSlug } = useParams();

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

  const basePath = `/${org}/${teamSlug}`;

  return { org, teamSlug, currentOrg, currentTeam, basePath, isLoading: !currentOrg || !currentTeam };
}
