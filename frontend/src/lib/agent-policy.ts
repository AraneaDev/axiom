import type { AgentPolicy, AgentPolicyRules } from '@/api/agent-policy.api';

export type PolicyScope = 'user' | 'org';

/** What the form holds: the effective values, as text where a person types. */
export interface PolicyFormValues {
  destructive: boolean;
  crossContainerMove: boolean;
  bulkOver: string;
  expiresMinutes: string;
  alsoRequire: string[];
  neverRequire: string[];
}

/** The limits the server enforces: 400 otherwise. */
export const LIMITS = {
  org: { bulkOver: [0, 1000], expiresMinutes: [10, 1440] },
  user: { bulkOver: [0, 10], expiresMinutes: [10, 60] },
} as const;

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
  return null;
}

/**
 * The rules to save: only what differs from the defaults, so a later change of a default still
 * reaches whoever never chose a value. A user keeps only stricter choices.
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
  const rules: AgentPolicyRules = {};
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
  if (values.alsoRequire.length > 0) rules.alsoRequire = values.alsoRequire;
  if (scope === 'org' && values.neverRequire.length > 0) rules.neverRequire = values.neverRequire;
  return rules;
}
