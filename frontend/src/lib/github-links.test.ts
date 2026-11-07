import { describe, expect, it } from 'vitest';

import { EXTERNAL_LINK, httpsHref } from './github-links';

describe('httpsHref', () => {
  it('keeps an https URL', () => {
    expect(httpsHref('https://github.com/acme-labs/widget/pull/1')).toBe(
      'https://github.com/acme-labs/widget/pull/1',
    );
  });

  it.each([
    ['javascript:alert(1)'],
    ['http://github.com/x'],
    ['data:text/html,<b>x</b>'],
    ['/relative/path'],
    ['not a url'],
    [''],
    [null],
    [undefined],
  ])('drops %s', (url) => {
    expect(httpsHref(url)).toBeUndefined();
  });

  it('opens in a new tab without the opener', () => {
    expect(EXTERNAL_LINK).toEqual({ target: '_blank', rel: 'noopener noreferrer' });
  });
});
