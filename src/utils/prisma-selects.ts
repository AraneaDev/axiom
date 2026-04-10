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

/** Include chain for team → org (used in deep includes for URL building) */
export const TEAM_ORG_INCLUDE = { team: { include: { org: true } } } as const;

/** Include chain for project → team → org (used in issue URL building) */
export const PROJECT_TEAM_ORG_INCLUDE = {
  project: { include: { team: { include: { org: true } } } },
} as const;

/** Include chain for repo → team → org (used in PR/repo URL building) */
export const REPO_TEAM_ORG_INCLUDE = {
  repo: { include: { team: { include: { org: true } } } },
} as const;

/** Include chain for space → team → org (used in wiki URL building) */
export const SPACE_TEAM_ORG_INCLUDE = {
  space: { include: { team: { include: { org: true } } } },
} as const;

/** Common issue include for list views: assignee, labels, column (id + name) */
export const ISSUE_LIST_INCLUDE = {
  assignee: { select: USER_BASIC_SELECT },
  labels: true,
  column: { select: { id: true, name: true } },
} as const;

/** Issue include with full column relation (used in create/update responses) */
export const ISSUE_WITH_COLUMN_INCLUDE = {
  assignee: { select: USER_BASIC_SELECT },
  labels: true,
  column: true,
} as const;

/** Hydrated issue include for automation rule evaluation */
export const AUTOMATION_ISSUE_INCLUDE = {
  assignee: { select: { id: true, username: true, displayName: true, email: true } },
  creator: { select: { id: true, username: true, displayName: true, email: true } },
  labels: { select: { name: true } },
  sprint: { select: { id: true, name: true, goal: true } },
  column: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, prefix: true } },
} as const;
