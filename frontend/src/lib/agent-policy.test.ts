import { describe, expect, it } from 'vitest';

import type { AgentPolicy, EffectiveAgentPolicy } from '@/api/agent-policy.api';

import { parseNames, problemWith, rulesFrom, valuesOf } from './agent-policy';

const defaults: EffectiveAgentPolicy = {
  requireFor: { destructive: true, admin: true, bulkOver: 10, crossContainerMove: true },
  expiresMinutes: 60,
  alsoRequire: [],
  neverRequire: [],
};

const policy: AgentPolicy = {
  scope: 'org',
  orgId: 'o1',
  rules: {},
  effective: defaults,
  defaults,
  writeActions: ['issue.update'],
};

describe('agent policy form values', () => {
  it('saves nothing for a form left at the defaults', () => {
    expect(rulesFrom('org', valuesOf(policy), policy)).toEqual({});
  });

  it('saves only what differs from the defaults', () => {
    const values = { ...valuesOf(policy), destructive: false, expiresMinutes: '120' };
    expect(rulesFrom('org', values, policy)).toEqual({ destructive: false, expiresMinutes: 120 });
  });

  it('never sends destructive, moves or neverRequire for a user', () => {
    const values = {
      ...valuesOf(policy),
      destructive: false,
      crossContainerMove: false,
      neverRequire: ['issue.delete'],
      alsoRequire: ['issue.update'],
    };
    expect(rulesFrom('user', values, policy)).toEqual({ alsoRequire: ['issue.update'] });
  });

  it('reads action names one per line, once each', () => {
    expect(parseNames('issue.update\n\n issue.update, page.update ')).toEqual([
      'issue.update',
      'page.update',
    ]);
  });

  it('refuses what the server would: an org expiry past a day, a user expiry past an hour', () => {
    const values = { ...valuesOf(policy), expiresMinutes: '1441' };
    expect(problemWith('org', values)).toMatch(/Expiry.*10 to 1440/);
    expect(problemWith('user', { ...values, expiresMinutes: '61' })).toMatch(/10 to 60/);
    expect(problemWith('org', { ...values, expiresMinutes: '1440' })).toBeNull();
  });

  it('refuses a user bulk threshold above 10 and a blank one', () => {
    const values = valuesOf(policy);
    expect(problemWith('user', { ...values, bulkOver: '11' })).toMatch(/0 to 10/);
    expect(problemWith('org', { ...values, bulkOver: '' })).toMatch(/whole number/);
  });
});
