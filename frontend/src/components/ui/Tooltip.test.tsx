import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('renders children', () => {
    render(
      <Tooltip content="Tip text">
        <button>Hover me</button>
      </Tooltip>,
    );
    expect(screen.getByText('Hover me')).toBeInTheDocument();
  });

  it('renders tooltip content in the DOM on hover', () => {
    render(
      <Tooltip content="Helpful tip">
        <span>Target</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Target').closest('span.inline-flex')!);
    expect(screen.getByText('Helpful tip')).toBeInTheDocument();
  });

  it('applies top position classes by default', () => {
    render(
      <Tooltip content="Top tip">
        <span>Target</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Target').closest('span.inline-flex')!);
    const tooltipBox = screen.getByText('Top tip').closest('span.fixed')!;
    expect(tooltipBox.querySelector('span[class*="top-full"]')).toBeTruthy();
  });

  it('applies bottom position classes when side="bottom"', () => {
    render(
      <Tooltip content="Bottom tip" side="bottom">
        <span>Target</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Target').closest('span.inline-flex')!);
    const tooltipBox = screen.getByText('Bottom tip').closest('span.fixed')!;
    expect(tooltipBox.querySelector('span[class*="bottom-full"]')).toBeTruthy();
  });

  it('applies left position classes when side="left"', () => {
    render(
      <Tooltip content="Left tip" side="left">
        <span>Target</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Target').closest('span.inline-flex')!);
    const tooltipBox = screen.getByText('Left tip').closest('span.fixed')!;
    expect(tooltipBox.querySelector('span[class*="left-full"]')).toBeTruthy();
  });

  it('applies right position classes when side="right"', () => {
    render(
      <Tooltip content="Right tip" side="right">
        <span>Target</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Target').closest('span.inline-flex')!);
    const tooltipBox = screen.getByText('Right tip').closest('span.fixed')!;
    expect(tooltipBox.querySelector('span[class*="right-full"]')).toBeTruthy();
  });
});
