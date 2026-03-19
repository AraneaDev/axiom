/**
 * Shared Prisma select/include fragments to reduce duplication.
 * Import these constants instead of repeating the same select objects.
 */

/** Basic user fields: id, username, displayName */
export const USER_BASIC_SELECT = {
  id: true,
  username: true,
  displayName: true,
} as const;

/** User fields with avatar: id, username, displayName, avatarUrl */
export const USER_WITH_AVATAR_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} as const;

/** Team-to-org chain for URL building: team.slug + org.slug */
export const TEAM_ORG_SELECT = {
  slug: true,
  org: { select: { slug: true } },
} as const;

/** Project select for issue URL building: prefix, slug, team.slug, org.slug */
export const PROJECT_URL_SELECT = {
  prefix: true,
  slug: true,
  team: { select: TEAM_ORG_SELECT },
} as const;

/** Project select with name for issue URL building + display */
export const PROJECT_URL_WITH_NAME_SELECT = {
  prefix: true,
  slug: true,
  name: true,
  team: { select: TEAM_ORG_SELECT },
} as const;

/** Repo select for URL building: id, slug, name, team.slug, org.slug */
export const REPO_URL_SELECT = {
  id: true,
  slug: true,
  name: true,
  team: { select: TEAM_ORG_SELECT },
} as const;

/** Wiki space select for URL building: id, name, slug, team.slug, org.slug */
export const SPACE_URL_SELECT = {
  id: true,
  name: true,
  slug: true,
  team: { select: TEAM_ORG_SELECT },
} as const;
