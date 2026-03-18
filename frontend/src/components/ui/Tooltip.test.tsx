import { render, screen } from '@testing-library/react';
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

  it('renders tooltip content in the DOM (hidden by CSS)', () => {
    render(
      <Tooltip content="Helpful tip">
        <span>Target</span>
      </Tooltip>,
    );
    expect(screen.getByText('Helpful tip')).toBeInTheDocument();
  });

  it('applies top position classes by default', () => {
    render(
      <Tooltip content="Top tip">
        <span>Target</span>
      </Tooltip>,
    );
    const tooltipWrapper = screen.getByText('Top tip').closest('span[class*="bottom-full"]');
    expect(tooltipWrapper).toBeTruthy();
  });

  it('applies bottom position classes when side="bottom"', () => {
    render(
      <Tooltip content="Bottom tip" side="bottom">
        <span>Target</span>
      </Tooltip>,
    );
    const tooltipWrapper = screen.getByText('Bottom tip').closest('span[class*="top-full"]');
    expect(tooltipWrapper).toBeTruthy();
  });

  it('applies left position classes when side="left"', () => {
    render(
      <Tooltip content="Left tip" side="left">
        <span>Target</span>
      </Tooltip>,
    );
    const tooltipWrapper = screen.getByText('Left tip').closest('span[class*="right-full"]');
    expect(tooltipWrapper).toBeTruthy();
  });

  it('applies right position classes when side="right"', () => {
    render(
      <Tooltip content="Right tip" side="right">
        <span>Target</span>
      </Tooltip>,
    );
    const tooltipWrapper = screen.getByText('Right tip').closest('span[class*="left-full"]');
    expect(tooltipWrapper).toBeTruthy();
  });
});
