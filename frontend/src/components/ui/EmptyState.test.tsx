import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No items found" />);
    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('renders description', () => {
    render(<EmptyState title="No items" description="Try adjusting your filters" />);
    expect(screen.getByText('Try adjusting your filters')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(<EmptyState title="Empty" icon={<svg data-testid="empty-icon" />} />);
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
  });

  it('does not render icon container when no icon provided', () => {
    const { container } = render(<EmptyState title="Empty" />);
    const iconContainer = container.querySelector('.text-text-tertiary');
    expect(iconContainer).toBeNull();
  });

  it('renders action button when provided', () => {
    render(<EmptyState title="Empty" action={<button>Create New</button>} />);
    expect(screen.getByText('Create New')).toBeInTheDocument();
  });

  it('does not render action area when no action provided', () => {
    const { container } = render(<EmptyState title="Empty" />);
    // Only the title heading should be present, no action wrapper
    expect(container.querySelectorAll('.mt-6')).toHaveLength(0);
  });
});
