import { describe, expect, it } from 'vitest';

import { authorName } from './authors';

describe('authorName', () => {
  it('shows the GitHub login of an imported author', () => {
    expect(authorName({ displayName: 'GitHub' }, 'voorbeeld-dev')).toBe('GitHub (voorbeeld-dev)');
  });

  it('shows the Axiom name otherwise', () => {
    expect(authorName({ displayName: 'Voorbeeld User' }, null)).toBe('Voorbeeld User');
    expect(authorName(undefined)).toBe('');
  });
});
