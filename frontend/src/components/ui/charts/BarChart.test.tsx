import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BarChart } from './BarChart';
import { useChartAnimation } from './useChartAnimation';

const FEW = [
  { label: 'Done', value: 5 },
  { label: 'Backlog', value: 2 },
];

/**
 * The font size of a text in the chart, as a share of the chart's width
 * @param container
 * @param text
 */
const relativeFont = (container: HTMLElement, text: string) => {
  const width = Number(container.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[2]);
  const node = [...container.querySelectorAll('text')].find((t) => t.textContent === text)!;
  return Number(node.getAttribute('font-size')) / width;
};

const bars = (container: HTMLElement) => [...container.querySelectorAll('rect')];
const attr = (bar: Element, name: string) => Number(bar.getAttribute(name));

describe('BarChart', () => {
  it('draws labels large enough to read: at least 2% of its width', () => {
    const { container } = render(<BarChart data={FEW} />);
    expect(relativeFont(container, 'Done')).toBeGreaterThanOrEqual(0.02);
  });

  it('is tall enough for its bars without being asked', () => {
    const { container } = render(<BarChart data={FEW} />);
    const [, , , height] = container.querySelector('svg')!.getAttribute('viewBox')!.split(' ');
    expect(Number(height)).toBeGreaterThanOrEqual(150);
  });

  it('spreads a few bars over its width, instead of bunching them on the left', () => {
    const { container } = render(<BarChart data={FEW} />);
    const width = Number(container.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[2]);
    const [first, second] = bars(container);
    expect(attr(first, 'width')).toBeGreaterThanOrEqual(32);
    expect(attr(second, 'x') + attr(second, 'width')).toBeGreaterThan(width * 0.6);
  });

  it('keeps every bar inside the chart with many of them', () => {
    const data = Array.from({ length: 40 }, (_, i) => ({ label: `Group ${i}`, value: i + 1 }));
    const { container } = render(<BarChart data={data} />);
    const width = Number(container.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[2]);
    const all = bars(container);
    expect(all).toHaveLength(40);
    expect(attr(all[39], 'x') + attr(all[39], 'width')).toBeLessThanOrEqual(width);
    expect(attr(all[0], 'width')).toBeGreaterThanOrEqual(4);
  });

  it('turns labels only when they do not fit under their bars', () => {
    const { container: short } = render(<BarChart data={FEW} />);
    const flat = [...short.querySelectorAll('text')].find((t) => t.textContent === 'Done')!;
    expect(flat.getAttribute('transform')).toBeNull();

    const data = Array.from({ length: 12 }, (_, i) => ({ label: `Long label ${i}`, value: 1 }));
    const { container: long } = render(<BarChart data={data} />);
    const turned = [...long.querySelectorAll('text')].find(
      (t) => t.textContent === 'Long label 0',
    )!;
    expect(turned.getAttribute('transform')).toContain('rotate');
  });

  it('shows each value once the bars have grown', async () => {
    render(<BarChart data={FEW} />);
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());
  });
});

describe('useChartAnimation', () => {
  it('stays at zero for a frame stamped before it started', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    try {
      const { result } = renderHook(() => useChartAnimation());
      act(() => frames[0](performance.now() - 5000));
      expect(result.current).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
