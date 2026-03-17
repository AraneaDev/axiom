import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Progress } from './Progress';

describe('Progress', () => {
  it('renders a progressbar', () => {
    const { container } = render(<Progress value={50} />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).toBeInTheDocument();
  });

  it('sets correct aria attributes', () => {
    const { container } = render(<Progress value={75} />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).toHaveAttribute('aria-valuenow', '75');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('sets the inner bar width to the value percentage', () => {
    const { container } = render(<Progress value={60} />);
    const inner = container.querySelector('[role="progressbar"] > div');
    expect(inner).toHaveStyle({ width: '60%' });
  });

  it('clamps value to 0 when negative', () => {
    const { container } = render(<Progress value={-10} />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    const inner = container.querySelector('[role="progressbar"] > div');
    expect(inner).toHaveStyle({ width: '0%' });
  });

  it('clamps value to 100 when over 100', () => {
    const { container } = render(<Progress value={150} />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    const inner = container.querySelector('[role="progressbar"] > div');
    expect(inner).toHaveStyle({ width: '100%' });
  });

  it('applies primary variant class by default', () => {
    const { container } = render(<Progress value={50} />);
    const inner = container.querySelector('[role="progressbar"] > div');
    expect(inner?.className).toContain('bg-primary');
  });

  it('applies success variant class', () => {
    const { container } = render(<Progress value={50} variant="success" />);
    const inner = container.querySelector('[role="progressbar"] > div');
    expect(inner?.className).toContain('bg-success');
  });

  it('applies warning variant class', () => {
    const { container } = render(<Progress value={50} variant="warning" />);
    const inner = container.querySelector('[role="progressbar"] > div');
    expect(inner?.className).toContain('bg-warning');
  });

  it('applies danger variant class', () => {
    const { container } = render(<Progress value={50} variant="danger" />);
    const inner = container.querySelector('[role="progressbar"] > div');
    expect(inner?.className).toContain('bg-danger');
  });

  it('applies sm size class', () => {
    const { container } = render(<Progress value={50} size="sm" />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.className).toContain('h-1');
  });

  it('applies md size class by default', () => {
    const { container } = render(<Progress value={50} />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.className).toContain('h-2');
  });

  it('applies lg size class', () => {
    const { container } = render(<Progress value={50} size="lg" />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.className).toContain('h-3');
  });

  it('applies custom className', () => {
    const { container } = render(<Progress value={50} className="my-custom-class" />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.className).toContain('my-custom-class');
  });
});
