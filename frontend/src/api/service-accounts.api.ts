import type { ActivityEvent } from './activity.api';
import { ApiError, del, get, patch, post, put } from './client';

export type ServiceAccountStatus = 'ACTIVE' | 'SUSPENDED';
/** Why a bot is suspended: it lost its last owner, or someone suspended it by hand */
export type ServiceAccountSuspendedReason = 'ORPHANED' | 'MANUAL';

export interface ServiceAccountOwner {
  id: string;
  username: string;
  displayName: string;
}

export interface ServiceAccountTeam {
  id: string;
  name: string;
  slug: string;
  role: 'ADMIN' | 'MEMBER' | 'VIEWER';
}

/** A bot as the list shows it */
export interface ServiceAccountSummary {
  id: string;
  orgId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  description: string;
  status: ServiceAccountStatus;
  suspendedReason: ServiceAccountSuspendedReason | null;
  suspendedAt: string | null;
  createdById: string | null;
  createdAt: string;
  owners: ServiceAccountOwner[];
  teams: ServiceAccountTeam[];
  /** When any of its tokens last called the API */
  lastUsedAt: string | null;
}

/** A bot's token as it is listed: never the raw token, only its prefix */
export interface ServiceAccountToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  rotatedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

/** A token as it is made or rotated: the one time its raw value comes back */
export interface NewServiceAccountToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
  token: string;
}

/** A team or space the bot may join: one of its owners can open it, and it is not there yet */
export interface JoinablePlace {
  id: string;
  name: string;
  slug: string;
}

/** One bot with its places and tokens */
export interface ServiceAccountDetail extends Omit<ServiceAccountSummary, 'lastUsedAt'> {
  spaces: { id: string; name: string; slug: string; level: string }[];
  tokens: ServiceAccountToken[];
  /** Only on a read of the bot itself, not on what a change answers */
  joinable?: { teams: JoinablePlace[]; spaces: JoinablePlace[] };
}

/** One activity of a bot, with the issue or page it is about */
export interface ServiceAccountActivity extends ActivityEvent {
  resourceTitle: string | null;
  resourceLink: string | null;
  resourceKey: string | null;
}

/** Service accounts (bots) of an org: org admins manage them, owners read and suspend theirs. */
export const serviceAccountsApi = {
  list: (orgId: string) => get<ServiceAccountSummary[]>(`/orgs/${orgId}/service-accounts`),
  get: (id: string) => get<ServiceAccountDetail>(`/service-accounts/${encodeURIComponent(id)}`),
  activity: (id: string) =>
    get<ServiceAccountActivity[]>(`/service-accounts/${encodeURIComponent(id)}/activity`),
  create: (
    orgId: string,
    data: { username: string; displayName: string; description?: string; ownerIds: string[] },
  ) => post<ServiceAccountSummary>(`/orgs/${orgId}/service-accounts`, data),
  update: (id: string, data: { displayName?: string; description?: string }) =>
    patch<ServiceAccountDetail>(`/service-accounts/${encodeURIComponent(id)}`, data),
  setOwners: (id: string, ownerIds: string[]) =>
    put<ServiceAccountDetail>(`/service-accounts/${encodeURIComponent(id)}/owners`, { ownerIds }),
  suspend: (id: string) =>
    post<ServiceAccountDetail>(`/service-accounts/${encodeURIComponent(id)}/suspend`, {}),
  resume: (id: string) =>
    post<ServiceAccountDetail>(`/service-accounts/${encodeURIComponent(id)}/resume`, {}),
  delete: (id: string) => del(`/service-accounts/${encodeURIComponent(id)}`),
  createToken: (id: string, data: { name: string; scopes: string[]; expiresInDays: number }) =>
    post<NewServiceAccountToken>(`/service-accounts/${encodeURIComponent(id)}/tokens`, data),
  rotateToken: (id: string, tokenId: string) =>
    post<NewServiceAccountToken>(
      `/service-accounts/${encodeURIComponent(id)}/tokens/${encodeURIComponent(tokenId)}/rotate`,
      {},
    ),
  revokeToken: (id: string, tokenId: string) =>
    del(`/service-accounts/${encodeURIComponent(id)}/tokens/${encodeURIComponent(tokenId)}`),
};

/** What each refusal of a service account action means, in plain words */
const MESSAGES: Record<string, string> = {
  SERVICE_ACCOUNT_NOT_FOUND: 'This service account does not exist, or you cannot see it.',
  SERVICE_ACCOUNT_OWNER_INVALID:
    'Each owner must be a person in this organization with role member or above.',
  SERVICE_ACCOUNT_OWNER_NEEDED:
    'Each team, space and page the bot is in needs an owner who can open it. Remove the bot ' +
    'there first, or keep an owner who is there.',
  SERVICE_ACCOUNT_OWNER_NOT_MEMBER:
    'The bot can only join where one of its owners can open the place too.',
  SERVICE_ACCOUNT_ORPHANED: 'This service account has no owner. Add an owner to resume it.',
  SERVICE_ACCOUNT_SUSPENDED: 'This service account is suspended. Resume it first.',
  SERVICE_ACCOUNT_ROLE_LIMIT: 'A bot is at most a member of a team and can at most edit a space.',
  SERVICE_ACCOUNT_ROLE_FIXED: "A bot's org role is always member.",
  SERVICE_ACCOUNT_MANAGED_BY_ORG: 'A bot leaves its organization only by being deleted.',
  SERVICE_ACCOUNT_ADMIN_SCOPE: 'A service account token has no admin scope.',
  SERVICE_ACCOUNT_TOKEN_ELSEWHERE: "A bot's tokens are made on its own page.",
  SERVICE_ACCOUNT_USE_SUSPEND: 'A bot is not deactivated. Suspend it on its page instead.',
  SERVICE_ACCOUNT_NO_USER_POLICY: "A bot has no rules of its own: its org's rules hold.",
  SERVICE_ACCOUNT_DEACTIVATED: 'The service account that asked for this was deleted.',
  SERVICE_ACCOUNT_NOT_APPROVER: 'A bot cannot approve or be asked to approve.',
  SERVICE_ACCOUNT_NOT_ASSIGNABLE: 'A bot cannot be assigned an issue.',
  SERVICE_ACCOUNT_NOT_INVITABLE: 'A bot cannot be invited or added to an organization.',
  SERVICE_ACCOUNT_NOT_WATCHER: 'A bot cannot watch an issue.',
  TOKEN_ALREADY_ROTATED: 'This token was already rotated. Rotate its replacement instead.',
  TOKEN_NOT_FOUND: 'This token no longer exists. It may have been revoked.',
  USERNAME_TAKEN: 'That username is taken.',
  FORBIDDEN: 'Only an org owner or admin can do this.',
  UI_ONLY: 'This can only be done in the web UI, never with a token.',
  TOKEN_BLOCKED: 'No token can do this.',
  SCOPE: 'Your token does not have the scope for this.',
};

/**
 * A failed service account call in plain words: the meaning of its code when it has one, its own
 * message otherwise.
 * @param error - What the call failed with
 * @param fallback - The text for an error that carries nothing
 */
export function serviceAccountError(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof ApiError && error.code && MESSAGES[error.code]) return MESSAGES[error.code];
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
