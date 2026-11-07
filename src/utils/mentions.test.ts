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

  it('should extract username part from email-like patterns', () => {
    // The regex matches @host in email@host
    expect(parseMentions('email@host')).toEqual(['host']);
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
