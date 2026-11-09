import { describe, expect, it } from 'vitest';

import type { AgentPolicy, EffectiveAgentPolicy } from '@/api/agent-policy.api';

import { formatMinutes, parseNames, problemWith, rulesFrom, valuesOf } from './agent-policy';

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

  it('keeps stored rules the form does not show', () => {
    const stored: AgentPolicy = {
      ...policy,
      rules: { destructive: false, laterRule: 'kept' },
    };
    const values = { ...valuesOf(stored), destructive: true };
    expect(rulesFrom('org', values, stored)).toEqual({ laterRule: 'kept' });
  });

  it("edits how long a bot's requests wait for an org, 10080 minutes unless set", () => {
    expect(valuesOf(policy).botExpiresMinutes).toBe('10080');
    const stored: AgentPolicy = {
      ...policy,
      rules: { botExpiresMinutes: 120 },
      effective: { ...defaults, botExpiresMinutes: 120 },
      defaults: { ...defaults, botExpiresMinutes: 10080 },
    };
    expect(valuesOf(stored).botExpiresMinutes).toBe('120');
    expect(rulesFrom('org', valuesOf(stored), stored)).toEqual({ botExpiresMinutes: 120 });
    // Back at the default, the rule is dropped
    expect(rulesFrom('org', { ...valuesOf(stored), botExpiresMinutes: '10080' }, stored)).toEqual(
      {},
    );
  });

  it("keeps a stored bot expiry on a user's save: the user form has no such field", () => {
    const stored: AgentPolicy = { ...policy, scope: 'user', rules: { botExpiresMinutes: 120 } };
    expect(rulesFrom('user', valuesOf(stored), stored)).toEqual({ botExpiresMinutes: 120 });
  });

  it('refuses a bot expiry outside 60 to 43200 minutes, for an org only', () => {
    const values = valuesOf(policy);
    expect(problemWith('org', { ...values, botExpiresMinutes: '59' })).toMatch(/60 to 43200/);
    expect(problemWith('org', { ...values, botExpiresMinutes: '43201' })).toMatch(/60 to 43200/);
    expect(problemWith('org', { ...values, botExpiresMinutes: '43200' })).toBeNull();
    expect(problemWith('user', { ...values, botExpiresMinutes: '1' })).toBeNull();
  });

  it('says a number of minutes in days and hours', () => {
    expect(formatMinutes(10080)).toBe('7 days');
    expect(formatMinutes(60)).toBe('1 hour');
    expect(formatMinutes(1500)).toBe('1 day 1 hour');
    expect(formatMinutes(90)).toBe('1 hour 30 minutes');
    expect(formatMinutes(43200)).toBe('30 days');
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
