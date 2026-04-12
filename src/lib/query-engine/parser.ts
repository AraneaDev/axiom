import type { Expression, Value, ComparisonOp } from './ast';
import { tokenize, TokenType } from './lexer';
import type { Token, DurationArg } from './lexer';

class ParseError extends Error {
  position: number;
  token?: string;

  constructor(message: string, position: number, token?: string) {
    super(message);
    this.position = position;
    this.token = token;
  }
}

function isSimpleMode(tokens: Token[]): boolean {
  for (const tok of tokens) {
    if (
      tok.type === TokenType.OPERATOR ||
      tok.type === TokenType.AND ||
      tok.type === TokenType.OR ||
      tok.type === TokenType.NOT ||
      tok.type === TokenType.IN ||
      tok.type === TokenType.NOT_IN ||
      tok.type === TokenType.LPAREN ||
      tok.type === TokenType.RPAREN ||
      tok.type === TokenType.FUNCTION
    ) {
      return false;
    }
  }
  return true;
}

function durationArgToValue(arg: DurationArg): Value {
  // duration args not used as Values in AST directly; this is a fallback
  return { type: 'string', value: `${arg.value}${arg.unit}` };
}

function parseSimple(tokens: Token[]): Expression {
  const expressions: Expression[] = [];
  const freetextParts: string[] = [];

  for (const tok of tokens) {
    if (tok.type === TokenType.FIELD_VALUE) {
      // Flush freetext if any
      if (freetextParts.length > 0) {
        expressions.push({ type: 'freetext', value: freetextParts.join(' ') });
        freetextParts.length = 0;
      }

      const rawValue = tok.value;
      const negated = rawValue.startsWith('!');
      const cleanValue = negated ? rawValue.slice(1) : rawValue;

      if (cleanValue === '@me') {
        expressions.push({
          type: 'comparison',
          field: tok.field,
          operator: negated ? '!=' : '=',
          value: { type: 'function', name: 'currentuser', args: [] },
        });
      } else if (cleanValue.includes(',')) {
        const parts = cleanValue.split(',').map((v) => ({ type: 'string' as const, value: v }));
        expressions.push({
          type: 'in',
          field: tok.field,
          values: parts,
          negated,
        });
      } else {
        expressions.push({
          type: 'comparison',
          field: tok.field,
          operator: negated ? '!=' : '=',
          value: { type: 'string', value: cleanValue },
        });
      }
    } else if (tok.type === TokenType.FREETEXT) {
      freetextParts.push(tok.value);
    }
  }

  if (freetextParts.length > 0) {
    expressions.push({ type: 'freetext', value: freetextParts.join(' ') });
  }

  if (expressions.length === 0) {
    throw new ParseError('Unexpected end of input', 0);
  }

  return expressions.reduce((left, right) => ({
    type: 'and',
    left,
    right,
  }));
}

class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    const tok = this.tokens[this.pos];
    if (!tok) {
      throw new ParseError('Unexpected end of input', this.lastPosition());
    }
    this.pos++;
    return tok;
  }

  private lastPosition(): number {
    const last = this.tokens[this.tokens.length - 1];
    return last ? last.position + 1 : 0;
  }

  private currentPosition(): number {
    const tok = this.peek();
    return tok ? tok.position : this.lastPosition();
  }

  parse(): Expression {
    const expr = this.parseOr();
    if (this.peek()) {
      const tok = this.peek()!;
      throw new ParseError(`Unexpected token: ${JSON.stringify(tok)}`, tok.position);
    }
    return expr;
  }

  private parseOr(): Expression {
    let left = this.parseAnd();
    while (this.peek()?.type === TokenType.OR) {
      this.consume();
      const right = this.parseAnd();
      left = { type: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): Expression {
    let left = this.parseNot();
    while (this.peek()?.type === TokenType.AND) {
      this.consume();
      const right = this.parseNot();
      left = { type: 'and', left, right };
    }
    return left;
  }

  private parseNot(): Expression {
    if (this.peek()?.type === TokenType.NOT) {
      this.consume();
      const operand = this.parsePrimary();
      return { type: 'not', operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expression {
    const tok = this.peek();
    if (!tok) {
      throw new ParseError('Unexpected end of input', this.lastPosition());
    }

    // Parenthesized expression
    if (tok.type === TokenType.LPAREN) {
      this.consume();
      const expr = this.parseOr();
      const close = this.peek();
      if (!close || close.type !== TokenType.RPAREN) {
        throw new ParseError('Expected closing parenthesis', this.currentPosition());
      }
      this.consume();
      return expr;
    }

    // IDENTIFIER followed by operator, IN, or NOT_IN
    if (tok.type === TokenType.IDENTIFIER) {
      this.consume();
      const field = tok.value.toLowerCase();

      const next = this.peek();
      if (!next) {
        throw new ParseError('Unexpected end of input after field name', tok.position);
      }

      // NOT IN
      if (next.type === TokenType.NOT_IN) {
        this.consume();
        const values = this.parseInList();
        return { type: 'in', field, values, negated: true };
      }

      // IN
      if (next.type === TokenType.IN) {
        this.consume();
        const values = this.parseInList();
        return { type: 'in', field, values, negated: false };
      }

      // Comparison operator
      if (next.type === TokenType.OPERATOR) {
        this.consume();
        const operator = next.value as ComparisonOp;
        const value = this.parseValue();
        return { type: 'comparison', field, operator, value };
      }

      throw new ParseError(
        `Unexpected token after field "${field}"`,
        next.position,
        String(next.type),
      );
    }

    throw new ParseError(`Unexpected token: ${tok.type}`, tok.position, String(tok.type));
  }

  private parseInList(): Value[] {
    const open = this.peek();
    if (!open || open.type !== TokenType.LPAREN) {
      throw new ParseError('Expected "(" after IN', this.currentPosition());
    }
    this.consume();

    const values: Value[] = [];
    while (true) {
      const val = this.parseValue();
      values.push(val);
      const next = this.peek();
      if (!next || next.type === TokenType.RPAREN) break;
      if (next.type === TokenType.COMMA) {
        this.consume();
      } else {
        break;
      }
    }

    const close = this.peek();
    if (!close || close.type !== TokenType.RPAREN) {
      throw new ParseError('Expected ")" after IN list', this.currentPosition());
    }
    this.consume();
    return values;
  }

  private parseValue(): Value {
    const tok = this.peek();
    if (!tok) {
      throw new ParseError('Unexpected end of input, expected value', this.lastPosition());
    }

    if (tok.type === TokenType.STRING) {
      this.consume();
      return { type: 'string', value: tok.value };
    }

    if (tok.type === TokenType.NUMBER) {
      this.consume();
      return { type: 'number', value: tok.value };
    }

    if (tok.type === TokenType.FUNCTION) {
      this.consume();
      // Convert DurationArgs to Value[] — functions store their own args separately
      // The AST Value for a function has args: Value[]
      // Duration args from the lexer are not directly Value, so we convert
      const valueArgs: Value[] = tok.args.map((a) => durationArgToValue(a));
      return { type: 'function', name: tok.name, args: valueArgs };
    }

    if (tok.type === TokenType.IDENTIFIER) {
      this.consume();
      return { type: 'string', value: tok.value.toLowerCase() };
    }

    throw new ParseError(`Unexpected token: ${tok.type}`, tok.position, String(tok.type));
  }
}

/**
 *
 * @param input
 */
export function parse(input: string): Expression {
  const tokens = tokenize(input);

  if (tokens.length === 0) {
    throw new ParseError('Unexpected end of input', 0);
  }

  if (isSimpleMode(tokens)) {
    return parseSimple(tokens);
  }

  const parser = new Parser(tokens);
  return parser.parse();
}
