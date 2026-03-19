import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Badge } from './Badge';

describe('Badge', () => {
  it('renders with text content', () => {
    render(<Badge>Status</Badge>);
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('applies default variant classes', () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText('Default');
    expect(badge.className).toContain('bg-surface-tertiary');
  });

  it('applies primary variant classes', () => {
    render(<Badge variant="primary">Primary</Badge>);
    const badge = screen.getByText('Primary');
    expect(badge.className).toContain('bg-primary-light');
    expect(badge.className).toContain('text-primary');
  });

  it('applies danger variant classes', () => {
    render(<Badge variant="danger">Danger</Badge>);
    const badge = screen.getByText('Danger');
    expect(badge.className).toContain('bg-danger-light');
  });

  it('applies warning variant classes', () => {
    render(<Badge variant="warning">Warning</Badge>);
    const badge = screen.getByText('Warning');
    expect(badge.className).toContain('bg-warning-light');
  });

  it('applies success variant classes', () => {
    render(<Badge variant="success">Success</Badge>);
    const badge = screen.getByText('Success');
    expect(badge.className).toContain('bg-success-light');
  });

  it('applies outline variant classes', () => {
    render(<Badge variant="outline">Outline</Badge>);
    const badge = screen.getByText('Outline');
    expect(badge.className).toContain('border-border');
  });

  it('applies sm size classes', () => {
    render(<Badge size="sm">Small</Badge>);
    const badge = screen.getByText('Small');
    expect(badge.className).toContain('px-1.5');
  });

  it('applies md size classes by default', () => {
    render(<Badge>Medium</Badge>);
    const badge = screen.getByText('Medium');
    expect(badge.className).toContain('px-2');
  });

  it('renders with icon', () => {
    render(
      <Badge>
        <svg data-testid="badge-icon" />
        Label
      </Badge>,
    );
    expect(screen.getByTestId('badge-icon')).toBeInTheDocument();
    expect(screen.getByText('Label')).toBeInTheDocument();
  });
});
