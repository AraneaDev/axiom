import { get, put } from './client';

export interface AgentPolicyRules {
  destructive?: boolean;
  bulkOver?: number;
  crossContainerMove?: boolean;
  expiresMinutes?: number;
  alsoRequire?: string[];
  /** Org rules only. Never lifts admin actions. */
  neverRequire?: string[];
  /** Org rules only: how long a service account's request waits for its owners. */
  botExpiresMinutes?: number;
  /** Rules this form does not know yet: kept as stored, so a save never drops them. */
  [rule: string]: unknown;
}

export interface EffectiveAgentPolicy {
  requireFor: {
    destructive: boolean;
    admin: true;
    bulkOver: number;
    crossContainerMove: boolean;
  };
  expiresMinutes: number;
  alsoRequire: string[];
  neverRequire: string[];
  botExpiresMinutes?: number;
}

export interface AgentPolicy {
  scope: 'user' | 'org';
  orgId: string | null;
  rules: AgentPolicyRules;
  effective: EffectiveAgentPolicy;
  defaults: EffectiveAgentPolicy;
  /** The names a user may list in alsoRequire. */
  writeActions: string[];
}

/** The rules that decide which agent actions wait for approval, for you or for an org. */
export const agentPolicyApi = {
  getUser: () => get<AgentPolicy>('/agent-policy?scope=user'),
  getOrg: (orgId: string) =>
    get<AgentPolicy>(`/agent-policy?scope=org&orgId=${encodeURIComponent(orgId)}`),
  update: (data: { scope: 'user' | 'org'; orgId?: string; rules: AgentPolicyRules }) =>
    put<AgentPolicy>('/agent-policy', data),
};
