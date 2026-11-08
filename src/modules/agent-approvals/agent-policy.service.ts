import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { DEFAULT_POLICY, isToken, type EffectivePolicy } from '../../actions/approval-policy';
import type { ActionContext, ActionDef } from '../../actions/define';
import { listActions } from '../../actions/registry';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';
import { isServiceAccount } from '../service-accounts/person';

export const MIN_EXPIRES_MINUTES = 10;
export const MAX_EXPIRES_MINUTES = 24 * 60;
/** How long a bot's request waits: its owners may not be around within the hour an agent's waits */
export const BOT_DEFAULT_EXPIRES_MINUTES = 7 * 24 * 60;
export const MIN_BOT_EXPIRES_MINUTES = 60;
export const MAX_BOT_EXPIRES_MINUTES = 30 * 24 * 60;
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
  /** Org only: how long a service account's request waits for its owners */
  botExpiresMinutes: z
    .number()
    .int()
    .min(MIN_BOT_EXPIRES_MINUTES)
    .max(MAX_BOT_EXPIRES_MINUTES)
    .optional(),
  /** Action names */
  alsoRequire: actionNames.optional(),
  /** Org only */
  neverRequire: actionNames.optional(),
});
export type PolicyRules = z.infer<typeof rulesSchema>;

export type PolicyScope = 'org' | 'user';

/**
 * The policy a caller is held to, with the lists the defaults leave empty, and the expiry of a
 * service account's request, which takes the place of expiresMinutes when a bot asks.
 */
export type FullPolicy = EffectivePolicy & {
  alsoRequire: string[];
  neverRequire: string[];
  botExpiresMinutes: number;
};

const BASE: FullPolicy = {
  ...DEFAULT_POLICY,
  alsoRequire: [],
  neverRequire: [],
  botExpiresMinutes: BOT_DEFAULT_EXPIRES_MINUTES,
};

/**
 * Rules as stored, read defensively: a row that no longer fits the schema counts as empty rather
 * than loosening or breaking every call.
 * @param value - The JSON column
 */
function parseRules(value: unknown): PolicyRules {
  const parsed = rulesSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  logger.error('an agent policy row no longer fits the schema and counts as empty', {
    issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  });
  return {};
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
    botExpiresMinutes: rules.botExpiresMinutes ?? BASE.botExpiresMinutes,
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
      botExpiresMinutes: Math.min(all.botExpiresMinutes, next.botExpiresMinutes),
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
    // An org setting only: user rules can't hold it
    botExpiresMinutes: policy.botExpiresMinutes,
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
  const orgLayers = [...new Set(orgIds)].map((orgId) =>
    withOrgRules(parseRules(byOrg.get(orgId) ?? {})),
  );
  const base = orgLayers.length > 0 ? strictest(orgLayers) : BASE;
  const own = rows.find((row) => row.userId === userId);
  return own ? withUserRules(base, parseRules(own.rules)) : base;
}

/** The input fields that name something with an org above it: the call's org is read from them. */
export const ORG_INPUT_FIELDS = [
  'orgId',
  'teamId',
  'projectId',
  'spaceId',
  'issueId',
  'issueIds',
  'pageId',
  'sprintId',
] as const;

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
  const projectIds = idsOf(given, 'projectId');
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
 * What a token reads when it runs a raw action that a rule names: such an action can't wait for
 * approval, so it is refused.
 * @param name - The action
 */
export function rawNamedRefusal(name: string): AppError {
  return new AppError(
    403,
    `Action ${name} can't wait for approval, and an approval rule of your organization or ` +
      `your own (alsoRequire) names it, so tokens may not run it. Do it in the web UI.`,
    'APPROVAL_UNAVAILABLE',
  );
}

/**
 * Refuse a token's raw action that a rule names, once the orgs it touches are known: a multipart
 * body is only read after the gate. A session is never refused.
 * @param ctx - Who runs it
 * @param name - The action
 * @param orgIds - The orgs it touches
 * @throws {AppError} 403
 */
export async function assertRawNotNamed(
  ctx: ActionContext,
  name: string,
  orgIds: readonly string[],
): Promise<void> {
  if (!isToken(ctx)) return;
  const policy = await effectivePolicy(ctx.userId, orgIds);
  if (policy.alsoRequire.includes(name)) throw rawNamedRefusal(name);
}

/**
 * The org of a service account, which holds its policy whatever its call names. None for a person.
 * @param userId - Who calls
 */
async function botOrgIds(userId: string): Promise<string[]> {
  if (!(await isServiceAccount(userId))) return [];
  const bot = await prisma.serviceAccount.findUnique({
    where: { userId },
    select: { orgId: true },
  });
  return bot ? [bot.orgId] : [];
}

/**
 * The policy of one call: the ids in its input and the lookup the action declares decide which
 * orgs count.
 * @param def - The action
 * @param ctx - Who runs it
 * @param input - The action's validated input
 */
export async function policyForCall(
  def: ActionDef,
  ctx: ActionContext,
  input: unknown,
): Promise<FullPolicy> {
  const [named, declared] = await Promise.all([
    orgIdsOfInput(input),
    def.orgIds ? def.orgIds(ctx, input) : [],
  ]);
  return effectivePolicy(ctx.userId, [
    ...new Set([...named, ...declared, ...(await botOrgIds(ctx.userId))]),
  ]);
}

/**
 * Raw actions a rule may name. They can't wait (A6), so a token's call is refused (403) while a
 * rule names them: that is how an org binds uploads, whose files attach to anything later.
 */
const RAW_NAMEABLE: ReadonlySet<string> = new Set(['attachment.upload']);

/** The names a rule may add with alsoRequire: actions that write and that a token may call. */
export function writeActionNames(): string[] {
  return listActions()
    .filter(
      (def) =>
        def.kind === 'write' &&
        !def.uiOnly &&
        !def.tokenBlocked &&
        (!def.rest?.raw || RAW_NAMEABLE.has(def.name)),
    )
    .map((def) => def.name)
    .sort();
}

/**
 * Refuse names that are no action a token may call, so a misspelt rule is a 400 rather than a rule
 * that binds nothing. An admin action can't be exempted: it always waits.
 * @param rules - The rules being saved
 * @throws {AppError} 400
 */
function assertKnownNames(rules: PolicyRules): void {
  const known = new Set(writeActionNames());
  const unknown = (rules.alsoRequire ?? []).filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new AppError(
      400,
      `alsoRequire takes names of actions that write; not known: ${unknown.slice(0, 5).join(', ')}`,
    );
  }
  const admin = new Set(
    listActions()
      .filter((def) => def.admin)
      .map((def) => def.name),
  );
  const badExempt = (rules.neverRequire ?? []).filter(
    (name) => !known.has(name) || admin.has(name),
  );
  if (badExempt.length > 0) {
    throw new AppError(
      400,
      `neverRequire takes names of actions that write and are not admin actions; not accepted: ${badExempt.slice(0, 5).join(', ')}`,
    );
  }
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
  if (rules.botExpiresMinutes !== undefined) {
    throw new AppError(
      400,
      'Only an organization owner sets how long service account requests wait',
      'ORG_ONLY_RULE',
    );
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
  assertKnownNames(rules);
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
 * Refuse rules of its own for a service account: its org's rules hold, and an approved request
 * must not add a row the spec says a bot never has.
 * @param userId - Whose rules
 * @param scope - org or user
 * @throws {AppError} 400 SERVICE_ACCOUNT_NO_USER_POLICY
 */
async function assertScopeFor(userId: string, scope: PolicyScope): Promise<void> {
  if (scope === 'user' && (await isServiceAccount(userId))) {
    throw new AppError(
      400,
      "A service account has no approval rules of its own: its organization's rules hold",
      'SERVICE_ACCOUNT_NO_USER_POLICY',
    );
  }
}

/**
 * The checks a save makes, also run by the preview so no request waits on rules that can't save.
 * @param scope - org or user
 * @param rules - The rules
 * @throws {AppError} 400
 */
export function assertRulesAllowed(scope: PolicyScope, rules: PolicyRules): void {
  if (scope === 'user') assertUserRulesTighten(rules);
  else assertKnownNames(rules);
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
  await assertScopeFor(userId, scope);
  assertRulesAllowed(scope, rules);
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

/** At most this many names of one list in a preview before it counts the rest. */
const PREVIEW_NAMES = 25;

/**
 * Names for a preview, bounded.
 * @param names - Action names
 */
function listed(names: string[]): string {
  const shown = names.slice(0, PREVIEW_NAMES).join(', ');
  return names.length > PREVIEW_NAMES ? `${shown} and ${names.length - PREVIEW_NAMES} more` : shown;
}

/**
 * What an approver reads before a rule change: whose rules, and first what gets looser compared
 * with the stored rules, as the database holds them. Built from the stored row and the validated
 * rules, never from the agent's text, and short enough that padding can't push the loosening past
 * the cut of a preview.
 * @param userId - The caller
 * @param scope - org or user
 * @param orgId - The org, for scope org
 * @param rules - The rules the call would save
 */
export async function describePolicyChange(
  userId: string,
  scope: PolicyScope,
  orgId: string | undefined,
  rules: PolicyRules,
): Promise<string> {
  // Refuse before a request exists: one that could only fail is not made
  await assertScopeFor(userId, scope);
  assertRulesAllowed(scope, rules);
  const [org, row] = await Promise.all([
    scope === 'org' && orgId
      ? prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, slug: true } })
      : null,
    prisma.agentPolicy.findFirst({
      where: scope === 'org' ? { orgId } : { userId },
      select: { rules: true },
    }),
  ]);
  const before = withOrgRules(row ? parseRules(row.rules) : {});
  const after = withOrgRules(rules);
  const minus = (left: string[], right: string[]) => left.filter((name) => !right.includes(name));
  const looser: string[] = [];
  const stricter: string[] = [];
  const flip = (off: string, on: string, was: boolean, now: boolean) => {
    if (was && !now) looser.push(off);
    if (!was && now) stricter.push(on);
  };
  flip(
    'deletes need no approval',
    'deletes need approval again',
    before.requireFor.destructive,
    after.requireFor.destructive,
  );
  flip(
    'moves between projects or spaces need no approval',
    'moves between projects or spaces need approval again',
    before.requireFor.crossContainerMove,
    after.requireFor.crossContainerMove,
  );
  const lists: Array<[string[], string[], string]> = [
    [minus(after.neverRequire, before.neverRequire), looser, 'no approval needed for'],
    [minus(before.alsoRequire, after.alsoRequire), looser, 'approval no longer needed for'],
    [minus(after.alsoRequire, before.alsoRequire), stricter, 'approval needed for'],
    [minus(before.neverRequire, after.neverRequire), stricter, 'no longer exempt:'],
  ];
  for (const [names, into, label] of lists) {
    if (names.length > 0) into.push(`${label} ${names.length}: ${listed(names)}`);
  }
  const { bulkOver: bulkBefore } = before.requireFor;
  const { bulkOver: bulkAfter } = after.requireFor;
  if (bulkAfter !== bulkBefore) {
    (bulkAfter > bulkBefore ? looser : stricter).push(
      `bulk threshold ${bulkBefore} to ${bulkAfter}`,
    );
  }
  if (after.expiresMinutes !== before.expiresMinutes) {
    (after.expiresMinutes > before.expiresMinutes ? looser : stricter).push(
      `requests expire after ${after.expiresMinutes} minutes, not ${before.expiresMinutes}`,
    );
  }
  if (after.botExpiresMinutes !== before.botExpiresMinutes) {
    (after.botExpiresMinutes > before.botExpiresMinutes ? looser : stricter).push(
      `service account requests expire after ${after.botExpiresMinutes} minutes, not ${before.botExpiresMinutes}`,
    );
  }
  const whose =
    scope === 'org' ? `organization ${org?.name ?? '?'} (${org?.slug ?? '?'})` : 'your own tokens';
  const parts = [
    `Replace all approval rules of ${whose} with these; whatever they do not set goes back to the default, as of this request.`,
    looser.length > 0 ? `Looser: ${looser.join('; ')}.` : 'Nothing gets looser.',
    stricter.length > 0 ? `Stricter: ${stricter.join('; ')}.` : undefined,
  ];
  return parts.filter((part) => part !== undefined).join(' ');
}
