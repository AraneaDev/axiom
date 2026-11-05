import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AgentPolicy, EffectiveAgentPolicy } from '@/api/agent-policy.api';

import { AgentPolicyForm } from './AgentPolicyForm';

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
  writeActions: ['issue.update', 'page.update'],
};

describe('AgentPolicyForm', () => {
  it('saves the org rules that differ from the defaults', () => {
    const onSave = vi.fn();
    render(<AgentPolicyForm scope="org" policy={policy} canEdit saving={false} onSave={onSave} />);
    fireEvent.click(screen.getByRole('switch', { name: /destructive/i }));
    fireEvent.change(screen.getByLabelText('Also require approval for'), {
      target: { value: 'issue.update\npage.update' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save rules/i }));
    expect(onSave).toHaveBeenCalledWith({
      destructive: false,
      alsoRequire: ['issue.update', 'page.update'],
    });
  });

  it('lets a user pick write actions and offers nothing that would loosen', () => {
    const onSave = vi.fn();
    render(
      <AgentPolicyForm
        scope="user"
        policy={{ ...policy, scope: 'user' }}
        canEdit
        saving={false}
        onSave={onSave}
      />,
    );
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByLabelText('Never require approval for')).toBeNull();
    fireEvent.click(screen.getByLabelText('issue.update'));
    fireEvent.click(screen.getByRole('button', { name: /save rules/i }));
    expect(onSave).toHaveBeenCalledWith({ alsoRequire: ['issue.update'] });
  });

  it('says what is wrong instead of sending a value the server refuses', () => {
    const onSave = vi.fn();
    render(
      <AgentPolicyForm
        scope="user"
        policy={{ ...policy, scope: 'user' }}
        canEdit
        saving={false}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText('Expires after (minutes)'), {
      target: { value: '120' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save rules/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('10 to 60');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('is read only for someone who may not change the rules', () => {
    render(
      <AgentPolicyForm
        scope="org"
        policy={policy}
        canEdit={false}
        saving={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /save rules/i })).toBeNull();
    expect(screen.getByLabelText('Expires after (minutes)')).toBeDisabled();
  });
});
