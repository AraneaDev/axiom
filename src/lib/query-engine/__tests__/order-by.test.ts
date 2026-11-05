import { describe, expect, it } from 'vitest';

import { compileOrderBy } from '../compiler';
import { issueFieldRegistry } from '../fields/issue-fields';
import { ParseError } from '../lexer';
import { parse, parseQuery } from '../parser';

describe('parseQuery', () => {
  it('parses a where part and an ORDER BY clause', () => {
    const q = parseQuery('priority > Low ORDER BY priority DESC, updated ASC');
    expect(q.where).toEqual(parse('priority > Low'));
    expect(q.orderBy).toEqual([
      { field: 'priority', dir: 'desc' },
      { field: 'updated', dir: 'asc' },
    ]);
  });

  it('defaults to ascending and allows ORDER BY alone', () => {
    expect(parseQuery('ORDER BY title')).toEqual({
      where: null,
      orderBy: [{ field: 'title', dir: 'asc' }],
    });
  });

  it('leaves a query without a clause as parse() reads it', () => {
    expect(parseQuery('type = Bug')).toEqual({ where: parse('type = Bug'), orderBy: [] });
  });

  it('does not read ORDER BY inside quotes or in lowercase as a clause', () => {
    expect(parseQuery('title ~ "ORDER BY x"').orderBy).toEqual([]);
    expect(parseQuery('type = Bug AND title ~ "a ORDER BY b"').orderBy).toEqual([]);
    expect(parseQuery('order by title').orderBy).toEqual([]);
  });

  it('refuses fields that cannot be sorted, naming the field', () => {
    expect(() => parseQuery('type = Bug ORDER BY label')).toThrow('label cannot be sorted');
    for (const field of ['blocked', 'blocks', 'linked', 'text', 'cf.Owner']) {
      expect(() => parseQuery(`ORDER BY ${field}`)).toThrow(ParseError);
    }
  });

  it('refuses unknown fields, bad directions, empty terms and repeats', () => {
    expect(() => parseQuery('ORDER BY nope')).toThrow(/Unknown field 'nope'/);
    expect(() => parseQuery('ORDER BY title UP')).toThrow(/ASC or DESC/);
    expect(() => parseQuery('ORDER BY')).toThrow(/expects a field/);
    expect(() => parseQuery('ORDER BY title,')).toThrow(/expects a field/);
    expect(() => parseQuery('ORDER BY title DESC extra')).toThrow(ParseError);
    expect(() => parseQuery('ORDER BY title, title DESC')).toThrow(/twice/);
  });

  it('reports the position in the whole input', () => {
    try {
      parseQuery('type = Bug ORDER BY title, label');
      expect.unreachable();
    } catch (error) {
      expect((error as ParseError).position).toBe(27);
    }
  });

  it('keeps parse() as it was', () => {
    // The words after a comparison search as text, as before
    expect(JSON.stringify(parse('type = Bug ORDER BY title'))).toContain('freetext');
  });
});

describe('compileOrderBy', () => {
  it('ends in id and puts nulls last', () => {
    expect(compileOrderBy([{ field: 'storypoints', dir: 'desc' }])).toEqual([
      { storyPoints: { sort: 'desc', nulls: 'last' } },
      { id: 'asc' },
    ]);
  });
});

describe('sortable fields', () => {
  it('agrees between the parser and the compiler for every registry field', () => {
    for (const field of Object.keys(issueFieldRegistry)) {
      let parsed = true;
      try {
        parseQuery(`ORDER BY ${field}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ParseError);
        parsed = false;
      }
      // What the parser lets through, the compiler can compile
      if (parsed) expect(() => compileOrderBy([{ field, dir: 'asc' }])).not.toThrow();
      else expect(() => compileOrderBy([{ field, dir: 'asc' }])).toThrow('cannot be sorted');
    }
  });
});
