import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Card } from './Card';

describe('Card', () => {
  it('renders with children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('applies default variant classes', () => {
    const { container } = render(<Card>Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('border-border');
    expect(card.className).toContain('bg-surface');
  });

  it('applies elevated variant classes', () => {
    const { container } = render(<Card variant="elevated">Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('shadow-md');
  });

  it('applies ghost variant classes', () => {
    const { container } = render(<Card variant="ghost">Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('bg-surface-secondary');
  });

  it('applies sm size classes', () => {
    const { container } = render(<Card size="sm">Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('p-3');
  });

  it('applies md size classes by default', () => {
    const { container } = render(<Card>Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('p-4');
  });

  it('applies lg size classes', () => {
    const { container } = render(<Card size="lg">Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('p-6');
  });

  it('applies hover effect when hover prop is true', () => {
    const { container } = render(<Card hover>Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('hover-lift');
    expect(card.className).toContain('cursor-pointer');
  });

  it('renders header slot', () => {
    render(<Card header="Card Header">Body</Card>);
    expect(screen.getByText('Card Header')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('renders footer slot', () => {
    render(<Card footer="Card Footer">Body</Card>);
    expect(screen.getByText('Card Footer')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('renders header and footer together', () => {
    render(
      <Card header="Header" footer="Footer">
        Body
      </Card>,
    );
    expect(screen.getByText('Header')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });
});
