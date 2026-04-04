import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { PriorityBadge } from './PriorityBadge';

describe('PriorityBadge', () => {
  it('renders the full priority label by default', () => {
    render(<PriorityBadge priority="HIGH" />);
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('renders the first character when display is short', () => {
    render(<PriorityBadge priority="CRITICAL" display="short" />);
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('applies correct color classes for priority', () => {
    render(<PriorityBadge priority="MEDIUM" />);
    const badge = screen.getByText('Medium');
    expect(badge.className).toContain('bg-primary-light');
    expect(badge.className).toContain('text-primary');
  });
});
