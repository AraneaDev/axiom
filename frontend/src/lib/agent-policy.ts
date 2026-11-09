import type { AgentPolicy, AgentPolicyRules } from '@/api/agent-policy.api';

export type PolicyScope = 'user' | 'org';

/** What the form holds: the effective values, as text where a person types. */
export interface PolicyFormValues {
  destructive: boolean;
  crossContainerMove: boolean;
  bulkOver: string;
  expiresMinutes: string;
  /** Org only: how long a bot's request waits for its owners */
  botExpiresMinutes: string;
  alsoRequire: string[];
  neverRequire: string[];
}

/** The limits the server enforces: 400 otherwise. */
export const LIMITS = {
  org: { bulkOver: [0, 1000], expiresMinutes: [10, 1440] },
  user: { bulkOver: [0, 10], expiresMinutes: [10, 60] },
} as const;

/** How long a bot's request may wait, in minutes, and how long it waits unless an org says */
export const BOT_EXPIRES_LIMITS = [60, 43200] as const;
export const BOT_EXPIRES_DEFAULT = 10080;

/**
 * A number of minutes in days, hours and minutes, leaving out what is zero.
 * @param minutes - The minutes
 */
export function formatMinutes(minutes: number): string {
  const parts: [number, string][] = [
    [Math.floor(minutes / 1440), 'day'],
    [Math.floor((minutes % 1440) / 60), 'hour'],
    [minutes % 60, 'minute'],
  ];
  const said = parts.filter(([n]) => n > 0).map(([n, word]) => `${n} ${word}${n === 1 ? '' : 's'}`);
  return said.length > 0 ? said.join(' ') : '0 minutes';
}

/**
 * The form values for a policy.
 * @param policy - The policy as the server gave it
 */
export function valuesOf(policy: AgentPolicy): PolicyFormValues {
  const { effective } = policy;
  return {
    destructive: effective.requireFor.destructive,
    crossContainerMove: effective.requireFor.crossContainerMove,
    bulkOver: String(effective.requireFor.bulkOver),
    expiresMinutes: String(effective.expiresMinutes),
    botExpiresMinutes: String(
      effective.botExpiresMinutes ?? policy.defaults.botExpiresMinutes ?? BOT_EXPIRES_DEFAULT,
    ),
    alsoRequire: policy.rules.alsoRequire ?? [],
    neverRequire: policy.rules.neverRequire ?? [],
  };
}

/**
 * A line per action name: blanks and repeats drop out.
 * @param text - What was typed
 */
export function parseNames(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))];
}

/**
 * The first thing the server would refuse, in words; null when the form is fine.
 * @param scope - Whose rules
 * @param values - The form
 */
export function problemWith(scope: PolicyScope, values: PolicyFormValues): string | null {
  const limits = LIMITS[scope];
  for (const [field, label] of [
    ['bulkOver', 'Bulk threshold'],
    ['expiresMinutes', 'Expiry'],
  ] as const) {
    const [min, max] = limits[field];
    const value = Number(values[field]);
    if (values[field].trim() === '' || !Number.isInteger(value) || value < min || value > max) {
      return `${label} is a whole number from ${min} to ${max}`;
    }
  }
  if (scope === 'org') {
    const [min, max] = BOT_EXPIRES_LIMITS;
    const value = Number(values.botExpiresMinutes);
    if (
      values.botExpiresMinutes.trim() === '' ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    ) {
      return `A bot's request wait is a whole number of minutes from ${min} to ${max}`;
    }
  }
  return null;
}

/** The rules this form edits: any other stored rule is kept as it is on save. */
const FORM_RULES = [
  'destructive',
  'crossContainerMove',
  'bulkOver',
  'expiresMinutes',
  'alsoRequire',
  'neverRequire',
] as const;

/** The rules only the org form edits: a user's save keeps them as stored */
const ORG_FORM_RULES = ['botExpiresMinutes'] as const;

/**
 * The rules to save: only what differs from the defaults, so a later change of a default still
 * reaches whoever never chose a value. A user keeps only stricter choices. A save replaces every
 * rule, so the stored rules the form does not show (botExpiresMinutes on a user's form, or one
 * added later) are kept.
 * @param scope - Whose rules
 * @param values - The form
 * @param policy - The policy the form started from
 */
export function rulesFrom(
  scope: PolicyScope,
  values: PolicyFormValues,
  policy: AgentPolicy,
): AgentPolicyRules {
  const { defaults } = policy;
  const rules: AgentPolicyRules = Object.fromEntries(
    Object.entries(policy.rules).filter(
      ([key]) =>
        !(FORM_RULES as readonly string[]).includes(key) &&
        !(scope === 'org' && (ORG_FORM_RULES as readonly string[]).includes(key)),
    ),
  );
  if (scope === 'org') {
    if (values.destructive !== defaults.requireFor.destructive) {
      rules.destructive = values.destructive;
    }
    if (values.crossContainerMove !== defaults.requireFor.crossContainerMove) {
      rules.crossContainerMove = values.crossContainerMove;
    }
  }
  if (Number(values.bulkOver) !== defaults.requireFor.bulkOver) {
    rules.bulkOver = Number(values.bulkOver);
  }
  if (Number(values.expiresMinutes) !== defaults.expiresMinutes) {
    rules.expiresMinutes = Number(values.expiresMinutes);
  }
  if (scope === 'org') {
    const botDefault = defaults.botExpiresMinutes ?? BOT_EXPIRES_DEFAULT;
    if (Number(values.botExpiresMinutes) !== botDefault) {
      rules.botExpiresMinutes = Number(values.botExpiresMinutes);
    }
  }
  if (values.alsoRequire.length > 0) rules.alsoRequire = values.alsoRequire;
  if (scope === 'org' && values.neverRequire.length > 0) rules.neverRequire = values.neverRequire;
  return rules;
}
