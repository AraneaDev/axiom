import { render, screen } from '@testing-library/react';
import { ArrowLeft } from 'lucide-react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { ButtonLink } from './ButtonLink';

describe('ButtonLink', () => {
  it('is a link with the href and the accessible name, and holds no button', () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/admin" variant="ghost" size="sm">
          <ArrowLeft className="h-4 w-4" /> Back to admin
        </ButtonLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Back to admin' });
    expect(link).toHaveAttribute('href', '/admin');
    expect(link.querySelector('button')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reuses the Button variant and size classes and keeps a custom className', () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/x" variant="outline" size="xs" className="mt-3">
          Go
        </ButtonLink>
      </MemoryRouter>,
    );
    const cls = screen.getByRole('link', { name: 'Go' }).className;
    expect(cls).toContain('border-border');
    expect(cls).toContain('text-xs');
    expect(cls).toContain('mt-3');
  });
});
