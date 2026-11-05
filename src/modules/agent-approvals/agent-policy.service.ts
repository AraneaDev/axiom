import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { DEFAULT_POLICY, type EffectivePolicy } from '../../actions/approval-policy';
import { listActions } from '../../actions/registry';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

export const MIN_EXPIRES_MINUTES = 10;
export const MAX_EXPIRES_MINUTES = 24 * 60;
const MAX_BULK_OVER = 1000;
const MAX_LISTED_ACTIONS = 200;
const MAX_ACTION_NAME_LENGTH = 100;

const actionNames = z.array(z.string().min(1).max(MAX_ACTION_NAME_LENGTH)).max(MAX_LISTED_ACTIONS);

/** What a policy row holds. Unknown fields are refused, so a typo can't read as saved. */
export const rulesSchema = z.strictObject({
  destructive: z.boolean().optional(),
  bulkOver: z.number().int().min(0).max(MAX_BULK_OVER).optional(),
  crossContainerMove: z.boolean().optional(),
  expiresMinutes: z.number().int().min(MIN_EXPIRES_MINUTES).max(MAX_EXPIRES_MINUTES).optional(),
  /** Action names */
  alsoRequire: actionNames.optional(),
  /** Org only */
  neverRequire: actionNames.optional(),
});
export type PolicyRules = z.infer<typeof rulesSchema>;

export type PolicyScope = 'org' | 'user';

/** The policy a caller is held to, with the lists the defaults leave empty. */
export type FullPolicy = EffectivePolicy & { alsoRequire: string[]; neverRequire: string[] };

const BASE: FullPolicy = { ...DEFAULT_POLICY, alsoRequire: [], neverRequire: [] };

/**
 * Rules as stored, read defensively: a row that no longer fits the schema counts as empty rather
 * than loosening or breaking every call.
 * @param value - The JSON column
 */
function parseRules(value: unknown): PolicyRules {
  const parsed = rulesSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

/**
 * Defaults with an org's rules on top. An org may loosen or tighten, except admin, which no rule
 * reaches.
 * @param rules - The org's rules
 */
function withOrgRules(rules: PolicyRules): FullPolicy {
  return {
    requireFor: {
      ...BASE.requireFor,
      ...(rules.destructive !== undefined && { destructive: rules.destructive }),
      ...(rules.bulkOver !== undefined && { bulkOver: rules.bulkOver }),
      ...(rules.crossContainerMove !== undefined && {
        crossContainerMove: rules.crossContainerMove,
      }),
    },
    expiresMinutes: rules.expiresMinutes ?? BASE.expiresMinutes,
    alsoRequire: rules.alsoRequire ?? [],
    neverRequire: rules.neverRequire ?? [],
  };
}

/**
 * The strictest of several policies: what any of them requires, the smallest threshold, the
 * shortest expiry, and an exemption only where every one grants it.
 * @param policies - At least one
 */
function strictest(policies: FullPolicy[]): FullPolicy {
  const [first, ...rest] = policies;
  return rest.reduce<FullPolicy>(
    (all, next) => ({
      requireFor: {
        ...all.requireFor,
        destructive: all.requireFor.destructive || next.requireFor.destructive,
        bulkOver: Math.min(all.requireFor.bulkOver, next.requireFor.bulkOver),
        crossContainerMove: all.requireFor.crossContainerMove || next.requireFor.crossContainerMove,
      },
      expiresMinutes: Math.min(all.expiresMinutes, next.expiresMinutes),
      alsoRequire: [...new Set([...all.alsoRequire, ...next.alsoRequire])],
      neverRequire: all.neverRequire.filter((name) => next.neverRequire.includes(name)),
    }),
    first,
  );
}

/**
 * A policy with a user's rules on top. A user can only tighten: a threshold only lower, an expiry
 * only shorter, names only added. Whatever a stored row says beyond that is ignored.
 * @param policy - The policy so far
 * @param rules - The user's rules
 */
function withUserRules(policy: FullPolicy, rules: PolicyRules): FullPolicy {
  return {
    requireFor: {
      ...policy.requireFor,
      bulkOver: Math.min(policy.requireFor.bulkOver, rules.bulkOver ?? policy.requireFor.bulkOver),
      destructive: policy.requireFor.destructive || rules.destructive === true,
      crossContainerMove: policy.requireFor.crossContainerMove || rules.crossContainerMove === true,
    },
    expiresMinutes: Math.min(policy.expiresMinutes, rules.expiresMinutes ?? policy.expiresMinutes),
    alsoRequire: [...new Set([...policy.alsoRequire, ...(rules.alsoRequire ?? [])])],
    neverRequire: policy.neverRequire,
  };
}

/**
 * What a user's token is held to: the defaults, then the rules of the org (or orgs, taking the
 * strictest of them), then the user's own, which only tighten.
 * @param userId - The user whose token calls
 * @param orgIds - The orgs the call touches; none means the defaults plus the user's rules
 */
export async function effectivePolicy(
  userId: string,
  orgIds: readonly string[] = [],
): Promise<FullPolicy> {
  const rows = await prisma.agentPolicy.findMany({
    where: { OR: [{ userId }, ...(orgIds.length > 0 ? [{ orgId: { in: [...orgIds] } }] : [])] },
    select: { orgId: true, userId: true, rules: true },
  });
  const byOrg = new Map(rows.filter((row) => row.orgId).map((row) => [row.orgId, row.rules]));
  const orgLayers = [...new Set(orgIds)].map((orgId) => withOrgRules(parseRules(byOrg.get(orgId))));
  const base = orgLayers.length > 0 ? strictest(orgLayers) : BASE;
  const own = rows.find((row) => row.userId === userId);
  return own ? withUserRules(base, parseRules(own.rules)) : base;
}

/**
 * Every id of one field the input holds, as strings.
 * @param input - The validated input
 * @param field - The field name
 */
function idsOf(input: Record<string, unknown>, field: string): string[] {
  const value = input[field];
  if (typeof value === 'string' && value) return [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item !== '')
    : [];
}

/**
 * The orgs an action's input touches, through the project, team or space it names. An input that
 * names nothing, or something that is gone, has none: the defaults plus the user's rules apply.
 * @param input - The action's validated input
 */
export async function orgIdsOfInput(input: unknown): Promise<string[]> {
  if (!input || typeof input !== 'object') return [];
  const given = input as Record<string, unknown>;
  const orgs = new Set<string>(idsOf(given, 'orgId'));
  const teamIds = idsOf(given, 'teamId');
  const projectIds = [...idsOf(given, 'projectId'), ...idsOf(given, 'targetProjectId')];
  const spaceIds = idsOf(given, 'spaceId');
  const issueIds = [...idsOf(given, 'issueId'), ...idsOf(given, 'issueIds')];
  const pageIds = idsOf(given, 'pageId');
  const sprintIds = idsOf(given, 'sprintId');
  const [teams, projects, spaces, issues, pages, sprints] = await Promise.all([
    teamIds.length
      ? prisma.team.findMany({ where: { id: { in: teamIds } }, select: { orgId: true } })
      : [],
    projectIds.length
      ? prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { team: { select: { orgId: true } } },
        })
      : [],
    spaceIds.length
      ? prisma.wikiSpace.findMany({
          where: { id: { in: spaceIds } },
          select: { team: { select: { orgId: true } } },
        })
      : [],
    issueIds.length
      ? prisma.issue.findMany({
          where: { id: { in: issueIds } },
          select: { project: { select: { team: { select: { orgId: true } } } } },
        })
      : [],
    pageIds.length
      ? prisma.page.findMany({
          where: { id: { in: pageIds } },
          select: { space: { select: { team: { select: { orgId: true } } } } },
        })
      : [],
    sprintIds.length
      ? prisma.sprint.findMany({
          where: { id: { in: sprintIds } },
          select: { project: { select: { team: { select: { orgId: true } } } } },
        })
      : [],
  ]);
  for (const team of teams) orgs.add(team.orgId);
  for (const row of [...projects, ...spaces]) orgs.add(row.team.orgId);
  for (const row of [...issues, ...sprints]) orgs.add(row.project.team.orgId);
  for (const row of pages) orgs.add(row.space.team.orgId);
  return [...orgs];
}

/**
 * The policy of one call: its input decides which orgs count.
 * @param userId - The user whose token calls
 * @param input - The action's validated input
 */
export async function policyForCall(userId: string, input: unknown): Promise<FullPolicy> {
  return effectivePolicy(userId, await orgIdsOfInput(input));
}

/** The names a user may add with alsoRequire: actions that write and that a token may call. */
export function writeActionNames(): string[] {
  return listActions()
    .filter((def) => def.kind === 'write' && !def.uiOnly)
    .map((def) => def.name)
    .sort();
}

/**
 * Refuse user rules that would loosen anything (A13).
 * @param rules - The rules a user saves
 * @throws {AppError} 400
 */
function assertUserRulesTighten(rules: PolicyRules): void {
  if (rules.destructive === false || rules.crossContainerMove === false) {
    throw new AppError(400, 'Your own rules can only add approvals, not remove them');
  }
  if (rules.neverRequire !== undefined) {
    throw new AppError(400, 'Only an organization owner can exempt actions from approval');
  }
  if (rules.bulkOver !== undefined && rules.bulkOver > DEFAULT_POLICY.requireFor.bulkOver) {
    throw new AppError(
      400,
      `bulkOver can only be ${DEFAULT_POLICY.requireFor.bulkOver} or lower in your own rules`,
    );
  }
  if (rules.expiresMinutes !== undefined && rules.expiresMinutes > DEFAULT_POLICY.expiresMinutes) {
    throw new AppError(
      400,
      `expiresMinutes can only be ${DEFAULT_POLICY.expiresMinutes} or lower in your own rules`,
    );
  }
  const known = new Set(writeActionNames());
  const unknown = (rules.alsoRequire ?? []).filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new AppError(
      400,
      `alsoRequire takes names of actions that write; not known: ${unknown.slice(0, 5).join(', ')}`,
    );
  }
}

export type PolicyView = {
  scope: PolicyScope;
  orgId: string | null;
  rules: PolicyRules;
  effective: FullPolicy;
  defaults: FullPolicy;
  writeActions: string[];
};

/**
 * The rules of a scope and what they come to.
 * @param userId - The caller
 * @param scope - org or user
 * @param orgId - The org, required for scope org
 */
export async function getPolicy(
  userId: string,
  scope: PolicyScope,
  orgId?: string,
): Promise<PolicyView> {
  if (scope === 'org' && !orgId) throw new AppError(400, 'orgId is required for scope org');
  const row = await prisma.agentPolicy.findFirst({
    where: scope === 'org' ? { orgId } : { userId },
    select: { rules: true },
  });
  const rules = row ? parseRules(row.rules) : {};
  let effective: FullPolicy;
  if (scope === 'org') effective = withOrgRules(rules);
  else effective = await effectivePolicy(userId, orgId ? [orgId] : []);
  return {
    scope,
    orgId: orgId ?? null,
    rules,
    effective,
    defaults: BASE,
    writeActions: writeActionNames(),
  };
}

/**
 * Replace the rules of a scope. The caller's right to do so is the action's authorize.
 * @param userId - The caller
 * @param scope - org or user
 * @param orgId - The org, required for scope org
 * @param rules - The new rules
 * @throws {AppError} 400 for user rules that loosen
 */
export async function savePolicy(
  userId: string,
  scope: PolicyScope,
  orgId: string | undefined,
  rules: PolicyRules,
): Promise<PolicyView> {
  if (scope === 'org' && !orgId) throw new AppError(400, 'orgId is required for scope org');
  if (scope === 'user') assertUserRulesTighten(rules);
  const json = rules as Prisma.InputJsonObject;
  await (scope === 'org'
    ? prisma.agentPolicy.upsert({
        where: { orgId },
        create: { orgId, rules: json },
        update: { rules: json },
      })
    : prisma.agentPolicy.upsert({
        where: { userId },
        create: { userId, rules: json },
        update: { rules: json },
      }));
  return getPolicy(userId, scope, scope === 'org' ? orgId : undefined);
}
