import { describe, expect, it } from 'vitest';

import { branchNameFor, prefixOfKey } from './github-branch';

describe('branchNameFor', () => {
  it('joins the lower-case prefix, the number and the title slug', () => {
    expect(branchNameFor('AXM', 12, 'Fix the login timeout!')).toBe('axm-12-fix-the-login-timeout');
  });

  it('treats an accent as a separator, like the server, and collapses every other run of characters', () => {
    expect(branchNameFor('PLAT', 3, '  Café -- déjà vu / (again) ')).toBe(
      'plat-3-cafe-de-ja-vu-again',
    );
  });

  it('leaves the slug off when the title has no ASCII letters or digits', () => {
    expect(branchNameFor('AXM', 5, '!!!')).toBe('axm-5');
  });

  it('cuts a long slug to 40 characters at a whole word', () => {
    const name = branchNameFor('AXM', 1, 'make the widget cache survive restarts of everything');
    expect(name).toBe('axm-1-make-the-widget-cache-survive-restarts');
    expect(name.slice('axm-1-'.length).length).toBeLessThanOrEqual(40);
  });

  it('cuts a single long word at 40 characters', () => {
    expect(branchNameFor('AXM', 1, 'a'.repeat(60))).toBe(`axm-1-${'a'.repeat(40)}`);
  });
});

describe('prefixOfKey', () => {
  it('drops the number', () => {
    expect(prefixOfKey('AXM-12')).toBe('AXM');
    expect(prefixOfKey('A-B-7')).toBe('A-B');
  });
});
