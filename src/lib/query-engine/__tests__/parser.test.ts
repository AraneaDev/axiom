import { describe, it, expect } from 'vitest';

import { parse } from '../parser';

describe('parser', () => {
  describe('simple mode (key:value)', () => {
    it('parses single field:value as comparison', () => {
      const ast = parse('type:bug');
      expect(ast).toEqual({
        type: 'comparison',
        field: 'type',
        operator: '=',
        value: { type: 'string', value: 'bug' },
      });
    });

    it('parses comma-separated values as IN', () => {
      const ast = parse('priority:high,critical');
      expect(ast).toEqual({
        type: 'in',
        field: 'priority',
        values: [
          { type: 'string', value: 'high' },
          { type: 'string', value: 'critical' },
        ],
        negated: false,
      });
    });

    it('parses @me as currentUser function', () => {
      const ast = parse('assignee:@me');
      expect(ast).toEqual({
        type: 'comparison',
        field: 'assignee',
        operator: '=',
        value: { type: 'function', name: 'currentuser', args: [] },
      });
    });

    it('parses multiple key:value as AND', () => {
      const ast = parse('type:bug priority:high');
      expect(ast).toEqual({
        type: 'and',
        left: {
          type: 'comparison',
          field: 'type',
          operator: '=',
          value: { type: 'string', value: 'bug' },
        },
        right: {
          type: 'comparison',
          field: 'priority',
          operator: '=',
          value: { type: 'string', value: 'high' },
        },
      });
    });

    it('parses free text as freetext node', () => {
      const ast = parse('type:bug login error');
      expect(ast).toEqual({
        type: 'and',
        left: {
          type: 'comparison',
          field: 'type',
          operator: '=',
          value: { type: 'string', value: 'bug' },
        },
        right: { type: 'freetext', value: 'login error' },
      });
    });
  });

  describe('complex mode (operators)', () => {
    it('parses comparison with operator', () => {
      const ast = parse('storyPoints > 5');
      expect(ast).toEqual({
        type: 'comparison',
        field: 'storypoints',
        operator: '>',
        value: { type: 'number', value: 5 },
      });
    });

    it('parses AND expression', () => {
      const ast = parse('type = Bug AND priority = High');
      expect(ast).toEqual({
        type: 'and',
        left: {
          type: 'comparison',
          field: 'type',
          operator: '=',
          value: { type: 'string', value: 'bug' },
        },
        right: {
          type: 'comparison',
          field: 'priority',
          operator: '=',
          value: { type: 'string', value: 'high' },
        },
      });
    });

    it('parses OR expression', () => {
      const ast = parse('type = Bug OR type = Task');
      expect(ast).toEqual({
        type: 'or',
        left: {
          type: 'comparison',
          field: 'type',
          operator: '=',
          value: { type: 'string', value: 'bug' },
        },
        right: {
          type: 'comparison',
          field: 'type',
          operator: '=',
          value: { type: 'string', value: 'task' },
        },
      });
    });

    it('respects operator precedence (AND before OR)', () => {
      const ast = parse('type = Bug OR priority = High AND status = "In Progress"');
      expect(ast.type).toBe('or');
      if (ast.type === 'or') expect(ast.right.type).toBe('and');
    });

    it('respects parentheses', () => {
      const ast = parse('(type = Bug OR type = Task) AND priority = High');
      expect(ast.type).toBe('and');
      if (ast.type === 'and') expect(ast.left.type).toBe('or');
    });

    it('parses NOT expression', () => {
      const ast = parse('NOT type = Bug');
      expect(ast).toEqual({
        type: 'not',
        operand: {
          type: 'comparison',
          field: 'type',
          operator: '=',
          value: { type: 'string', value: 'bug' },
        },
      });
    });

    it('parses IN expression', () => {
      const ast = parse('type IN (Bug, Task, Story)');
      expect(ast).toEqual({
        type: 'in',
        field: 'type',
        values: [
          { type: 'string', value: 'bug' },
          { type: 'string', value: 'task' },
          { type: 'string', value: 'story' },
        ],
        negated: false,
      });
    });

    it('parses NOT IN expression', () => {
      const ast = parse('type NOT IN (Epic)');
      expect(ast).toEqual({
        type: 'in',
        field: 'type',
        values: [{ type: 'string', value: 'epic' }],
        negated: true,
      });
    });

    it('parses function call as value', () => {
      const ast = parse('assignee = currentUser()');
      expect(ast).toEqual({
        type: 'comparison',
        field: 'assignee',
        operator: '=',
        value: { type: 'function', name: 'currentuser', args: [] },
      });
    });

    it('parses contains operator', () => {
      const ast = parse('title ~ "login"');
      expect(ast).toEqual({
        type: 'comparison',
        field: 'title',
        operator: '~',
        value: { type: 'string', value: 'login' },
      });
    });

    it('parses != operator', () => {
      const ast = parse('assignee != empty()');
      expect(ast).toEqual({
        type: 'comparison',
        field: 'assignee',
        operator: '!=',
        value: { type: 'function', name: 'empty', args: [] },
      });
    });
  });

  describe('error handling', () => {
    it('throws QueryParseError with position for invalid input', () => {
      expect(() => parse('type = ')).toThrow();
      try {
        parse('type = ');
      } catch (e: unknown) {
        expect((e as { position: number }).position).toBeDefined();
        expect((e as Error).message).toContain('Unexpected');
      }
    });

    it('throws for unmatched parentheses', () => {
      expect(() => parse('(type = Bug')).toThrow();
    });
  });
});
