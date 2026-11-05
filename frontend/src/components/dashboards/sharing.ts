import type { DashboardInput, DashboardVisibility } from '@/api/dashboards.api';

export interface Sharing {
  visibility: DashboardVisibility;
  teamId: string | null;
  orgId: string | null;
}

/**
 * Whether the sharing can be saved: TEAM needs a team and ORG an org.
 * @param sharing - The sharing as chosen
 * @param sharing.visibility
 * @param sharing.teamId
 * @param sharing.orgId
 */
export function sharingComplete({ visibility, teamId, orgId }: Sharing): boolean {
  if (visibility === 'TEAM') return !!teamId;
  if (visibility === 'ORG') return !!orgId;
  return true;
}

/**
 * The sharing as the API takes it: only the team or org the visibility calls for.
 * @param sharing - The sharing as chosen
 * @param sharing.visibility
 * @param sharing.teamId
 * @param sharing.orgId
 */
export function sharingInput({ visibility, teamId, orgId }: Sharing): DashboardInput {
  return {
    visibility,
    ...(visibility === 'TEAM' && teamId ? { teamId } : {}),
    ...(visibility === 'ORG' && orgId ? { orgId } : {}),
  };
}
