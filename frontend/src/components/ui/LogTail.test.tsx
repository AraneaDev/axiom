import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LogTail } from './LogTail';

describe('LogTail', () => {
  it('shows the text literally in a scrollable monospace pre', () => {
    render(<LogTail text={'line one\n<b>bold</b> **x**'} />);
    const pre = screen.getByLabelText('Log tail');
    expect(pre.tagName).toBe('PRE');
    expect(pre.className).toContain('font-mono');
    expect(pre.className).toContain('overflow-auto');
    expect(pre.textContent).toBe('line one\n<b>bold</b> **x**');
    expect(pre.querySelector('b')).toBeNull();
  });

  it('notes a truncated log', () => {
    render(<LogTail text="tail" truncated />);
    expect(screen.getByText(/truncated/i)).toBeInTheDocument();
  });

  it('notes an unavailable log and shows no pre', () => {
    render(<LogTail text={null} unavailable />);
    expect(screen.getByText(/log unavailable/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Log tail')).toBeNull();
  });
});
