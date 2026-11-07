import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { checkStateOf } from '@/lib/github-checks';

import { CheckStatusIcon } from './CheckStatusIcon';

describe('CheckStatusIcon', () => {
  it.each([
    ['completed', 'success', 'passed'],
    ['completed', 'neutral', 'passed'],
    ['completed', 'failure', 'failed'],
    ['completed', 'timed_out', 'failed'],
    ['in_progress', null, 'running'],
    ['queued', null, 'running'],
    ['completed', 'skipped', 'skipped'],
    ['completed', 'cancelled', 'skipped'],
  ])('%s / %s reads as %s', (status, conclusion, state) => {
    expect(checkStateOf(status, conclusion)).toBe(state);
    render(<CheckStatusIcon status={status} conclusion={conclusion} />);
    expect(screen.getByLabelText(state)).toBeInTheDocument();
  });
});
