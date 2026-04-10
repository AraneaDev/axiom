import { describe, it, expect } from 'vitest';

import {
  chartColor,
  seqColor,
  calcViewBoxWidth,
  shortNumber,
  CHART_COLORS,
  CHART_SEQ_COLORS,
} from './chart-utils';

describe('chartColor', () => {
  it('returns palette colors by index', () => {
    expect(chartColor(0)).toBe(CHART_COLORS[0]);
    expect(chartColor(3)).toBe(CHART_COLORS[3]);
  });

  it('wraps around at palette length', () => {
    expect(chartColor(8)).toBe(CHART_COLORS[0]);
    expect(chartColor(10)).toBe(CHART_COLORS[2]);
  });
});

describe('seqColor', () => {
  it('returns lowest shade for min value', () => {
    expect(seqColor(0, 0, 100)).toBe(CHART_SEQ_COLORS[0]);
  });

  it('returns highest shade for max value', () => {
    expect(seqColor(100, 0, 100)).toBe(CHART_SEQ_COLORS[4]);
  });

  it('returns middle shade for mid value', () => {
    expect(seqColor(50, 0, 100)).toBe(CHART_SEQ_COLORS[2]);
  });

  it('handles equal min and max', () => {
    expect(seqColor(5, 5, 5)).toBe(CHART_SEQ_COLORS[0]);
  });

  it('clamps values below min', () => {
    expect(seqColor(-10, 0, 100)).toBe(CHART_SEQ_COLORS[0]);
  });

  it('clamps values above max', () => {
    expect(seqColor(200, 0, 100)).toBe(CHART_SEQ_COLORS[4]);
  });
});

describe('calcViewBoxWidth', () => {
  it('calculates total width from item count and spacing', () => {
    const w = calcViewBoxWidth(5, 20, 4, 30, 10);
    // 30 + 10 + 5*(20+4) + 4 = 164
    expect(w).toBe(164);
  });

  it('handles zero items', () => {
    expect(calcViewBoxWidth(0, 20, 4, 30, 10)).toBe(44);
  });
});

describe('shortNumber', () => {
  it('returns raw number for < 1000', () => {
    expect(shortNumber(42)).toBe('42');
    expect(shortNumber(999)).toBe('999');
  });

  it('formats thousands', () => {
    expect(shortNumber(1234)).toBe('1.2k');
    expect(shortNumber(56789)).toBe('56.8k');
  });

  it('formats millions', () => {
    expect(shortNumber(1_234_567)).toBe('1.2M');
  });

  it('handles negatives', () => {
    expect(shortNumber(-5000)).toBe('-5.0k');
  });
});
