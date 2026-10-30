import { describe, expect, it } from 'vitest';

import { sanitizeLandingHtml } from './sanitize-html';

describe('sanitizeLandingHtml', () => {
  it('removes event handlers even inside unwrapped elements', () => {
    const out = sanitizeLandingHtml('<foo><img src="x" onerror="alert(1)"></foo>');
    expect(out).not.toMatch(/onerror/i);
  });

  it('removes javascript: URLs in any case or with leading space', () => {
    for (const href of [' javascript:alert(1)', 'JaVaScRiPt:alert(1)', '\tjavascript:alert(1)']) {
      const out = sanitizeLandingHtml(`<a href="${href}">x</a>`);
      expect(out.toLowerCase()).not.toContain('javascript:');
    }
    const img = sanitizeLandingHtml('<img src="javascript:alert(1)">');
    expect(img.toLowerCase()).not.toContain('javascript:');
  });

  it('keeps ordinary formatting', () => {
    const out = sanitizeLandingHtml(
      '<h2>Hi</h2><p><strong>bold</strong> <a href="/x">link</a></p>',
    );
    expect(out).toContain('<h2>Hi</h2>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('href="/x"');
  });
});
