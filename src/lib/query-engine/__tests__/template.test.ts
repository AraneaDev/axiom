import { describe, it, expect } from 'vitest';

import { resolveTemplate } from '../template';

describe('template resolver', () => {
  const context = {
    issue: {
      number: 42,
      title: 'Fix login',
      priority: 'HIGH',
      assignee: { username: 'tim', displayName: 'Tim', email: 'tim@test.com' },
      labels: ['frontend', 'urgent'],
      column: { name: 'In Progress' },
      project: { name: 'Axiom', prefix: 'AXM' },
    },
    trigger: 'issue:created',
    actor: { username: 'jane', displayName: 'Jane', email: 'jane@test.com' },
  };

  it('resolves simple dot-path', () => {
    expect(resolveTemplate('Issue #{{issue.number}}', context)).toBe('Issue #42');
  });

  it('resolves nested dot-path', () => {
    expect(resolveTemplate('Assigned to {{issue.assignee.displayName}}', context)).toBe(
      'Assigned to Tim',
    );
  });

  it('resolves multiple expressions', () => {
    expect(resolveTemplate('{{issue.number}}: {{issue.title}}', context)).toBe('42: Fix login');
  });

  it('resolves unresolvable path to empty string', () => {
    expect(resolveTemplate('{{issue.nonexistent}}', context)).toBe('');
  });

  it('resolves null value to empty string', () => {
    const ctx = { ...context, issue: { ...context.issue, assignee: null } };
    expect(resolveTemplate('{{issue.assignee.displayName}}', ctx)).toBe('');
  });

  it('leaves text without expressions unchanged', () => {
    expect(resolveTemplate('No expressions here', context)).toBe('No expressions here');
  });

  it('resolves now() function', () => {
    const result = resolveTemplate('{{now()}}', context);
    expect(result).toBeTruthy();
    expect(result).not.toBe('{{now()}}');
  });

  it('resolves array values by joining', () => {
    expect(resolveTemplate('Labels: {{issue.labels}}', context)).toBe('Labels: frontend, urgent');
  });

  it('handles empty template', () => {
    expect(resolveTemplate('', context)).toBe('');
  });

  it('handles adjacent expressions', () => {
    expect(resolveTemplate('{{issue.project.prefix}}-{{issue.number}}', context)).toBe('AXM-42');
  });
});
