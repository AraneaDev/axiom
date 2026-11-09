import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UserName } from './UserName';

describe('UserName', () => {
  it('a service account shows its name with the bot marker', () => {
    const { container } = render(
      <p>
        <UserName user={{ displayName: 'Nightly Triage', kind: 'SERVICE' }} />
      </p>,
    );
    expect(screen.getByText('Nightly Triage')).toBeInTheDocument();
    expect(screen.getByText('bot')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide-bot')).not.toBeNull();
  });

  it('a person shows no marker', () => {
    const { container } = render(
      <p>
        <UserName user={{ displayName: 'Jan Voorbeeld', kind: 'PERSON' }} />
      </p>,
    );
    expect(screen.getByText('Jan Voorbeeld')).toBeInTheDocument();
    expect(screen.queryByText('bot')).toBeNull();
    expect(container.querySelector('svg.lucide-bot')).toBeNull();
  });

  it('a user without a kind and the integration user show no marker', () => {
    render(
      <p>
        <UserName user={{ displayName: 'Jan Voorbeeld' }} />
        <UserName user={{ displayName: 'GitHub', kind: 'INTEGRATION' }} />
      </p>,
    );
    expect(screen.queryByText('bot')).toBeNull();
  });

  it('an imported author keeps the GitHub (login) name and no marker', () => {
    render(
      <p>
        <UserName
          user={{ displayName: 'GitHub', kind: 'INTEGRATION' }}
          externalLogin="octo-voorbeeld"
        />
      </p>,
    );
    expect(screen.getByText('GitHub (octo-voorbeeld)')).toBeInTheDocument();
    expect(screen.queryByText('bot')).toBeNull();
  });

  it('a missing user renders nothing', () => {
    const { container } = render(
      <p>
        <UserName user={null} />
      </p>,
    );
    expect(container.textContent).toBe('');
  });
});
