export enum TokenType {
  IDENTIFIER = 'IDENTIFIER',
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  OPERATOR = 'OPERATOR',
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
  IN = 'IN',
  NOT_IN = 'NOT_IN',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  COMMA = 'COMMA',
  FIELD_VALUE = 'FIELD_VALUE',
  FUNCTION = 'FUNCTION',
  FREETEXT = 'FREETEXT',
}

export type DurationArg = { type: 'duration'; value: number; unit: string };

export type Token =
  | { type: TokenType.IDENTIFIER; value: string; position: number }
  | { type: TokenType.STRING; value: string; position: number }
  | { type: TokenType.NUMBER; value: number; position: number }
  | { type: TokenType.OPERATOR; value: string; position: number }
  | { type: TokenType.AND; position: number }
  | { type: TokenType.OR; position: number }
  | { type: TokenType.NOT; position: number }
  | { type: TokenType.IN; position: number }
  | { type: TokenType.NOT_IN; position: number }
  | { type: TokenType.LPAREN; position: number }
  | { type: TokenType.RPAREN; position: number }
  | { type: TokenType.COMMA; position: number }
  | { type: TokenType.FIELD_VALUE; field: string; value: string; position: number }
  | { type: TokenType.FUNCTION; name: string; args: DurationArg[]; position: number }
  | { type: TokenType.FREETEXT; value: string; position: number };

function isComplexMode(input: string): boolean {
  // Has explicit operators or keywords that indicate complex (SQL-like) mode
  const operatorPattern = /(?:=|!=|>=|<=|>|<|~)/;
  const keywordPattern = /\b(?:AND|OR|NOT|IN)\b/i;
  return operatorPattern.test(input) || keywordPattern.test(input);
}

function parseFunctionArgs(argsStr: string): DurationArg[] {
  const trimmed = argsStr.trim();
  if (!trimmed) return [];

  const durationMatch = trimmed.match(/^(-?\d+)([mhdw])$/);
  if (durationMatch) {
    return [{ type: 'duration', value: parseInt(durationMatch[1], 10), unit: durationMatch[2] }];
  }

  return [];
}

/**
 *
 * @param input
 */
export function tokenize(input: string): Token[] {
  const complex = isComplexMode(input);

  if (complex) {
    return tokenizeComplex(input);
  } else {
    return tokenizeSimple(input);
  }
}

function tokenizeSimple(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }

    const start = i;

    // Try key:value pattern
    const fieldValueMatch = input
      .slice(i)
      .match(/^([A-Za-z][A-Za-z0-9_]*):((?:@[A-Za-z]+|[^\s,]+)(?:,[^\s,]+)*)/);
    if (fieldValueMatch) {
      tokens.push({
        type: TokenType.FIELD_VALUE,
        field: fieldValueMatch[1],
        value: fieldValueMatch[2],
        position: start,
      });
      i += fieldValueMatch[0].length;
      continue;
    }

    // Bare word -> FREETEXT
    const wordMatch = input.slice(i).match(/^[^\s]+/);
    if (wordMatch) {
      tokens.push({ type: TokenType.FREETEXT, value: wordMatch[0], position: start });
      i += wordMatch[0].length;
      continue;
    }

    i++;
  }

  return tokens;
}

function tokenizeComplex(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }

    const start = i;

    // Quoted string
    if (input[i] === '"') {
      i++;
      let str = '';
      while (i < input.length && input[i] !== '"') {
        str += input[i++];
      }
      i++; // closing quote
      tokens.push({ type: TokenType.STRING, value: str, position: start });
      continue;
    }

    // Parentheses
    if (input[i] === '(') {
      tokens.push({ type: TokenType.LPAREN, position: start });
      i++;
      continue;
    }
    if (input[i] === ')') {
      tokens.push({ type: TokenType.RPAREN, position: start });
      i++;
      continue;
    }

    // Comma
    if (input[i] === ',') {
      tokens.push({ type: TokenType.COMMA, position: start });
      i++;
      continue;
    }

    // Operators (multi-char first)
    if (input[i] === '!' && input[i + 1] === '=') {
      tokens.push({ type: TokenType.OPERATOR, value: '!=', position: start });
      i += 2;
      continue;
    }
    if (input[i] === '>' && input[i + 1] === '=') {
      tokens.push({ type: TokenType.OPERATOR, value: '>=', position: start });
      i += 2;
      continue;
    }
    if (input[i] === '<' && input[i + 1] === '=') {
      tokens.push({ type: TokenType.OPERATOR, value: '<=', position: start });
      i += 2;
      continue;
    }
    if (input[i] === '=' || input[i] === '>' || input[i] === '<' || input[i] === '~') {
      tokens.push({ type: TokenType.OPERATOR, value: input[i], position: start });
      i++;
      continue;
    }

    // Number
    if (/\d/.test(input[i])) {
      let num = '';
      while (i < input.length && /\d/.test(input[i])) {
        num += input[i++];
      }
      tokens.push({ type: TokenType.NUMBER, value: parseInt(num, 10), position: start });
      continue;
    }

    // Identifier or keyword or function call
    if (/[A-Za-z_@]/.test(input[i])) {
      let word = '';
      while (i < input.length && /[A-Za-z0-9_@]/.test(input[i])) {
        word += input[i++];
      }

      const upper = word.toUpperCase();

      // Check for NOT IN (two-word token)
      if (upper === 'NOT') {
        // Peek ahead for IN
        let j = i;
        while (j < input.length && /\s/.test(input[j])) j++;
        if (
          input.slice(j, j + 2).toUpperCase() === 'IN' &&
          (j + 2 >= input.length || !/[A-Za-z0-9_]/.test(input[j + 2]))
        ) {
          tokens.push({ type: TokenType.NOT_IN, position: start });
          i = j + 2;
          continue;
        }
        tokens.push({ type: TokenType.NOT, position: start });
        continue;
      }

      if (upper === 'AND') {
        tokens.push({ type: TokenType.AND, position: start });
        continue;
      }
      if (upper === 'OR') {
        tokens.push({ type: TokenType.OR, position: start });
        continue;
      }
      if (upper === 'IN') {
        tokens.push({ type: TokenType.IN, position: start });
        continue;
      }

      // Check if function call: word followed by (
      let j = i;
      while (j < input.length && /\s/.test(input[j])) j++;
      if (input[j] === '(') {
        // Parse function args
        const argsStart = j + 1;
        let depth = 1;
        let k = argsStart;
        while (k < input.length && depth > 0) {
          if (input[k] === '(') depth++;
          else if (input[k] === ')') depth--;
          if (depth > 0) k++;
          else break;
        }
        const argsStr = input.slice(argsStart, k);
        const args = parseFunctionArgs(argsStr);
        tokens.push({ type: TokenType.FUNCTION, name: word.toLowerCase(), args, position: start });
        i = k + 1;
        continue;
      }

      // Regular identifier
      tokens.push({ type: TokenType.IDENTIFIER, value: word, position: start });
      continue;
    }

    // Skip unknown characters
    i++;
  }

  return tokens;
}
