import { describe, it, expect } from 'vitest';

import { tokenize, TokenType } from '../lexer';

describe('lexer', () => {
  it('tokenizes simple key:value', () => {
    const tokens = tokenize('type:bug');
    expect(tokens).toEqual([
      { type: TokenType.FIELD_VALUE, field: 'type', value: 'bug', position: 0 },
    ]);
  });

  it('tokenizes comma-separated values', () => {
    const tokens = tokenize('priority:high,critical');
    expect(tokens).toEqual([
      { type: TokenType.FIELD_VALUE, field: 'priority', value: 'high,critical', position: 0 },
    ]);
  });

  it('tokenizes @me as function', () => {
    const tokens = tokenize('assignee:@me');
    expect(tokens).toEqual([
      { type: TokenType.FIELD_VALUE, field: 'assignee', value: '@me', position: 0 },
    ]);
  });

  it('tokenizes complex mode with operators', () => {
    const tokens = tokenize('type = Bug AND priority > High');
    expect(tokens).toEqual([
      { type: TokenType.IDENTIFIER, value: 'type', position: 0 },
      { type: TokenType.OPERATOR, value: '=', position: 5 },
      { type: TokenType.IDENTIFIER, value: 'Bug', position: 7 },
      { type: TokenType.AND, position: 11 },
      { type: TokenType.IDENTIFIER, value: 'priority', position: 15 },
      { type: TokenType.OPERATOR, value: '>', position: 24 },
      { type: TokenType.IDENTIFIER, value: 'High', position: 26 },
    ]);
  });

  it('tokenizes parentheses', () => {
    const tokens = tokenize('(type = Bug OR type = Task)');
    expect(tokens).toEqual([
      { type: TokenType.LPAREN, position: 0 },
      { type: TokenType.IDENTIFIER, value: 'type', position: 1 },
      { type: TokenType.OPERATOR, value: '=', position: 6 },
      { type: TokenType.IDENTIFIER, value: 'Bug', position: 8 },
      { type: TokenType.OR, position: 12 },
      { type: TokenType.IDENTIFIER, value: 'type', position: 15 },
      { type: TokenType.OPERATOR, value: '=', position: 20 },
      { type: TokenType.IDENTIFIER, value: 'Task', position: 22 },
      { type: TokenType.RPAREN, position: 26 },
    ]);
  });

  it('tokenizes quoted strings', () => {
    const tokens = tokenize('title ~ "login bug"');
    expect(tokens).toEqual([
      { type: TokenType.IDENTIFIER, value: 'title', position: 0 },
      { type: TokenType.OPERATOR, value: '~', position: 6 },
      { type: TokenType.STRING, value: 'login bug', position: 8 },
    ]);
  });

  it('tokenizes numbers', () => {
    const tokens = tokenize('storyPoints > 5');
    expect(tokens).toEqual([
      { type: TokenType.IDENTIFIER, value: 'storyPoints', position: 0 },
      { type: TokenType.OPERATOR, value: '>', position: 12 },
      { type: TokenType.NUMBER, value: 5, position: 14 },
    ]);
  });

  it('tokenizes IN with value list', () => {
    const tokens = tokenize('type IN (Bug, Task)');
    expect(tokens).toEqual([
      { type: TokenType.IDENTIFIER, value: 'type', position: 0 },
      { type: TokenType.IN, position: 5 },
      { type: TokenType.LPAREN, position: 8 },
      { type: TokenType.IDENTIFIER, value: 'Bug', position: 9 },
      { type: TokenType.COMMA, position: 12 },
      { type: TokenType.IDENTIFIER, value: 'Task', position: 14 },
      { type: TokenType.RPAREN, position: 18 },
    ]);
  });

  it('tokenizes NOT IN', () => {
    const tokens = tokenize('type NOT IN (Bug)');
    expect(tokens).toEqual([
      { type: TokenType.IDENTIFIER, value: 'type', position: 0 },
      { type: TokenType.NOT_IN, position: 5 },
      { type: TokenType.LPAREN, position: 12 },
      { type: TokenType.IDENTIFIER, value: 'Bug', position: 13 },
      { type: TokenType.RPAREN, position: 16 },
    ]);
  });

  it('tokenizes function calls', () => {
    const tokens = tokenize('assignee = currentUser()');
    expect(tokens).toEqual([
      { type: TokenType.IDENTIFIER, value: 'assignee', position: 0 },
      { type: TokenType.OPERATOR, value: '=', position: 9 },
      { type: TokenType.FUNCTION, name: 'currentuser', args: [], position: 11 },
    ]);
  });

  it('tokenizes function with duration arg', () => {
    const tokens = tokenize('created > now(-7d)');
    expect(tokens).toEqual([
      { type: TokenType.IDENTIFIER, value: 'created', position: 0 },
      { type: TokenType.OPERATOR, value: '>', position: 8 },
      {
        type: TokenType.FUNCTION,
        name: 'now',
        args: [{ type: 'duration', value: -7, unit: 'd' }],
        position: 10,
      },
    ]);
  });

  it('tokenizes free text tokens', () => {
    const tokens = tokenize('type:bug login error');
    expect(tokens).toEqual([
      { type: TokenType.FIELD_VALUE, field: 'type', value: 'bug', position: 0 },
      { type: TokenType.FREETEXT, value: 'login', position: 9 },
      { type: TokenType.FREETEXT, value: 'error', position: 15 },
    ]);
  });

  it('is case insensitive for keywords', () => {
    const tokens = tokenize('type = Bug and priority = High');
    const andToken = tokens.find((t) => t.type === TokenType.AND);
    expect(andToken).toBeDefined();
  });
});
