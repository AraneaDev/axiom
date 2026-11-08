import { describe, it, expect } from 'vitest';

import { parseMentions, parseIssueRefs } from './mentions';

describe('parseMentions', () => {
  it('should parse a single mention', () => {
    expect(parseMentions('Hello @alice')).toEqual(['alice']);
  });

  it('should parse multiple mentions', () => {
    expect(parseMentions('@alice please review with @bob')).toEqual(['alice', 'bob']);
  });

  it('should deduplicate mentions', () => {
    expect(parseMentions('@alice and @alice again')).toEqual(['alice']);
  });

  it('should handle hyphens and underscores', () => {
    expect(parseMentions('@foo-bar @baz_qux')).toEqual(['foo-bar', 'baz_qux']);
  });

  it('should return empty array for no mentions', () => {
    expect(parseMentions('hello world')).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    expect(parseMentions('')).toEqual([]);
  });

  it('does not read an email address as a mention', () => {
    expect(parseMentions('email@host')).toEqual([]);
    expect(parseMentions('a@b.invalid')).toEqual([]);
    expect(parseMentions('mail a@b.invalid, @tim')).toEqual(['tim']);
  });

  it('needs a word boundary or the start of the text before the @', () => {
    expect(parseMentions('(@alice) "@bob" ,@carl **@dan**')).toEqual([
      'alice',
      'bob',
      'carl',
      'dan',
    ]);
    expect(parseMentions('x_@eve')).toEqual([]);
  });

  it('notifies after an even number of backslashes and not after an odd number', () => {
    expect(parseMentions('\\\\@tim')).toEqual(['tim']);
    expect(parseMentions('\\@tim')).toEqual([]);
    expect(parseMentions('\\\\\\@tim')).toEqual([]);
  });

  it('skips inline code, fenced and indented code', () => {
    expect(parseMentions('`@tim` and ``@ann``')).toEqual([]);
    expect(parseMentions('```\n@tim\n```\n@bob')).toEqual(['bob']);
    expect(parseMentions('text\n\n    @indented\n\n@after')).toEqual(['after']);
    expect(parseMentions('~~~js\n@tim\n~~~')).toEqual([]);
    expect(parseMentions('> `@tim` @quoted')).toEqual(['quoted']);
    expect(parseMentions('- item `@tim`\n- @listed')).toEqual(['listed']);
  });
});

describe('parseMentions reads text, not markup', () => {
  it('skips code inside a blockquote, a list continuation and a quoted fence', () => {
    expect(parseMentions('> line one\n> `@alice` in code')).toEqual([]);
    expect(parseMentions('- item\n  `@bob` in code')).toEqual([]);
    expect(parseMentions('> ```\n> @ivan\n> ```')).toEqual([]);
    expect(parseMentions('> `@x` @quoted')).toEqual(['quoted']);
    expect(parseMentions('- a\n  - `@carol` @listed')).toEqual(['listed']);
  });

  it('skips a link destination and raw code HTML, and counts the link text', () => {
    expect(parseMentions('[x](https://x.invalid/@dave)')).toEqual([]);
    expect(parseMentions('<code>@erin</code>')).toEqual([]);
    expect(parseMentions('[@fay](https://x.invalid/a)')).toEqual(['fay']);
  });

  it('never reads an autolink or a bare URL as a mention', () => {
    expect(parseMentions('see https://x.invalid/@tim')).toEqual([]);
    expect(parseMentions('<https://x.invalid/@tim>')).toEqual([]);
    expect(parseMentions('@gus https://x.invalid/@tim')).toEqual(['gus']);
  });

  it('gives no mention for a link whose text is its own address', () => {
    expect(parseMentions('[https://x.invalid/@tim](https://x.invalid/@tim)')).toEqual([]);
    expect(parseMentions('[a@b.invalid](mailto:a@b.invalid)')).toEqual([]);
  });

  it('reads two mentions joined by a hyphen', () => {
    expect(parseMentions('@frank-@gina')).toEqual(['frank-', 'gina']);
  });

  it('reads code in a table cell and a heading', () => {
    expect(parseMentions('| a |\n|---|\n| `@t` @cell |')).toEqual(['cell']);
    expect(parseMentions('# `@h` @head')).toEqual(['head']);
  });
});

describe('parseIssueRefs', () => {
  it('should parse a single issue ref with ^', () => {
    expect(parseIssueRefs('See ^AXM-123')).toEqual([{ prefix: 'AXM', number: 123 }]);
  });

  it('should parse multiple issue refs', () => {
    expect(parseIssueRefs('^AXM-1 and ^FOO-42')).toEqual([
      { prefix: 'AXM', number: 1 },
      { prefix: 'FOO', number: 42 },
    ]);
  });

  it('should deduplicate issue refs', () => {
    expect(parseIssueRefs('^AXM-1 ^AXM-1')).toEqual([{ prefix: 'AXM', number: 1 }]);
  });

  it('should return empty array for no refs', () => {
    expect(parseIssueRefs('no refs here')).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    expect(parseIssueRefs('')).toEqual([]);
  });

  it('should not match lowercase prefixes', () => {
    expect(parseIssueRefs('!axm-123')).toEqual([]);
  });

  it('should still match legacy # references for backwards compat', () => {
    expect(parseIssueRefs('See #AXM-123')).toEqual([{ prefix: 'AXM', number: 123 }]);
  });
});

describe('escaped sigils', () => {
  it('skips a mention preceded by an odd number of backslashes', () => {
    expect(parseMentions('\\@tim')).toEqual([]);
    expect(parseMentions('hi \\\\@tim')).toEqual(['tim']);
    expect(parseMentions('\\@tim and @sam')).toEqual(['sam']);
    expect(parseMentions('@tim')).toEqual(['tim']);
  });

  it('skips an issue reference preceded by an odd number of backslashes', () => {
    expect(parseIssueRefs('\\^AXM-1')).toEqual([]);
    expect(parseIssueRefs('\\#AXM-1')).toEqual([]);
    expect(parseIssueRefs('\\\\^AXM-1')).toEqual([{ prefix: 'AXM', number: 1 }]);
    expect(parseIssueRefs('^AXM-1')).toEqual([{ prefix: 'AXM', number: 1 }]);
  });
});

describe('parseIssueRefs in code and with escapes', () => {
  it('skips code', () => {
    expect(parseIssueRefs('`^AXM-1` ^AXM-2')).toEqual([{ prefix: 'AXM', number: 2 }]);
    expect(parseIssueRefs('```\n^AXM-1\n```')).toEqual([]);
  });

  it('reads an even number of backslashes as no escape', () => {
    expect(parseIssueRefs('\\\\^AXM-1')).toEqual([{ prefix: 'AXM', number: 1 }]);
    expect(parseIssueRefs('\\^AXM-1 \\#AXM-2')).toEqual([]);
  });
});
