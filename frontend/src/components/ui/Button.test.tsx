import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { Button } from './Button';

describe('Button', () => {
  it('renders with children text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('applies primary variant classes by default', () => {
    render(<Button>Primary</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-primary');
  });

  it('applies secondary variant classes', () => {
    render(<Button variant="secondary">Secondary</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-surface-tertiary');
  });

  it('applies danger variant classes', () => {
    render(<Button variant="danger">Danger</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-danger');
  });

  it('applies ghost variant classes', () => {
    render(<Button variant="ghost">Ghost</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('hover:bg-surface-tertiary');
  });

  it('applies outline variant classes', () => {
    render(<Button variant="outline">Outline</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('border-border');
  });

  it('applies xs size classes', () => {
    render(<Button size="xs">Tiny</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('px-2');
    expect(btn.className).toContain('py-1');
  });

  it('applies sm size classes', () => {
    render(<Button size="sm">Small</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('px-3');
  });

  it('applies md size classes by default', () => {
    render(<Button>Medium</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('px-4');
    expect(btn.className).toContain('py-2');
  });

  it('applies lg size classes', () => {
    render(<Button size="lg">Large</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('px-5');
  });

  it('handles onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders as disabled when disabled prop is true', () => {
    render(<Button disabled>Disabled</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn.className).toContain('opacity-40');
  });

  it('renders with an icon alongside text', () => {
    render(
      <Button>
        <svg data-testid="icon" />
        Label
      </Button>,
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByText('Label')).toBeInTheDocument();
  });
});
