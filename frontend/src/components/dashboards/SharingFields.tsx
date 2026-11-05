import { useQueries, useQuery } from '@tanstack/react-query';

import type { DashboardVisibility } from '@/api/dashboards.api';
import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { Select } from '@/components/ui/Dropdown';
import { STABLE_STALE_TIME } from '@/lib/constants';

import type { Sharing } from './sharing';

const VISIBILITY_OPTIONS = [
  { value: 'PRIVATE', label: 'Private, only you' },
  { value: 'TEAM', label: 'A team' },
  { value: 'ORG', label: 'An organization' },
];

/**
 * Choose who can open a dashboard, among the teams and orgs the user belongs to.
 * @param root0
 * @param root0.value
 * @param root0.onChange
 */
export function SharingFields({
  value,
  onChange,
}: {
  value: Sharing;
  onChange: (sharing: Sharing) => void;
}) {
  const { data: orgs = [] } = useQuery({
    queryKey: ['orgs'],
    queryFn: orgsApi.list,
    staleTime: STABLE_STALE_TIME,
  });
  const teamsPerOrg = useQueries({
    queries: orgs.map((org) => ({
      queryKey: ['teams', org.id],
      queryFn: () => teamsApi.listByOrg(org.id),
      staleTime: STABLE_STALE_TIME,
      enabled: value.visibility === 'TEAM',
    })),
  });
  const teamOptions = orgs.flatMap((org, index) =>
    (teamsPerOrg[index]?.data ?? []).map((team) => ({
      value: team.id,
      label: `${org.name} / ${team.name}`,
    })),
  );

  return (
    <>
      <Select
        label="Shared with"
        value={value.visibility}
        options={VISIBILITY_OPTIONS}
        onChange={(visibility) =>
          onChange({ ...value, visibility: visibility as DashboardVisibility })
        }
      />
      {value.visibility === 'TEAM' && (
        <Select
          label="Team"
          value={value.teamId ?? ''}
          options={teamOptions}
          placeholder="Choose a team"
          onChange={(teamId) => onChange({ ...value, teamId: teamId as string })}
        />
      )}
      {value.visibility === 'ORG' && (
        <Select
          label="Organization"
          value={value.orgId ?? ''}
          options={orgs.map((org) => ({ value: org.id, label: org.name }))}
          placeholder="Choose an organization"
          onChange={(orgId) => onChange({ ...value, orgId: orgId as string })}
        />
      )}
    </>
  );
}
