import { parseGroupBy, parseSelect } from './aggregate';
import type { Expression, Value, ComparisonOp, OrderByTerm, ParsedQuery } from './ast';
import { CUSTOM_FIELD_PREFIX } from './custom-fields';
import { issueFieldRegistry } from './fields/issue-fields';
import { ParseError, tokenize, TokenType } from './lexer';
import type { Token, DurationArg } from './lexer';

/**
 * Fields that only a structured comparison can ask about. These words came after the key:value form
 * was in use, so `done:x` stays the text it always was.
 */
const NOT_KEY_VALUE_FIELDS = new Set([
  'blocked',
  'blocks',
  'linked',
  'text',
  'done',
  'sprintstate',
]);

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
    if (tok.type === TokenType.FIELD_VALUE && NOT_KEY_VALUE_FIELDS.has(tok.field.toLowerCase())) {
      freetextParts.push(`${tok.field}:${tok.value}`);
    } else if (tok.type === TokenType.FIELD_VALUE) {
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
    // Text around a comparison searches, as it does around key:value
    const before = this.takeWords();
    let expr = this.parseOr();
    const after = this.takeWords();
    if (this.peek()) {
      const tok = this.peek()!;
      throw new ParseError(`Unexpected token: ${JSON.stringify(tok)}`, tok.position);
    }
    if (before) expr = { type: 'and', left: before, right: expr };
    return after ? { type: 'and', left: expr, right: after } : expr;
  }

  /** The bare words from here on, up to the next thing that isn't one, as one text node. */
  private takeWords(): Expression | null {
    const words: string[] = [];
    while (true) {
      const tok = this.peek();
      const next = this.tokens[this.pos + 1]?.type;
      const startsComparison =
        next === TokenType.OPERATOR || next === TokenType.IN || next === TokenType.NOT_IN;
      if (!tok || startsComparison) break;
      if (
        tok.type !== TokenType.IDENTIFIER &&
        tok.type !== TokenType.STRING &&
        tok.type !== TokenType.NUMBER
      ) {
        break;
      }
      words.push(String(tok.value));
      this.pos++;
    }
    return words.length > 0 ? { type: 'freetext', value: words.join(' ') } : null;
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

    // A field followed by operator, IN, or NOT_IN
    if (tok.type === TokenType.IDENTIFIER || tok.type === TokenType.CUSTOM_FIELD) {
      this.consume();
      const field =
        tok.type === TokenType.CUSTOM_FIELD
          ? `${CUSTOM_FIELD_PREFIX}${tok.name}`
          : tok.value.toLowerCase();

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
      const word = tok.value.toLowerCase();
      return word === 'null' ? { type: 'null' } : { type: 'string', value: word };
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

/** Why a field has no place in ORDER BY: the database can't order by it cleanly */
const UNSORTABLE_FIELDS = new Set(['label', 'blocked', 'blocks', 'linked', 'text']);

const CLAUSES = ['SELECT', 'WHERE', 'GROUP BY', 'ORDER BY'] as const;
type ClauseName = (typeof CLAUSES)[number];

interface Clause {
  name: ClauseName;
  /** Where the keyword starts */
  at: number;
  /** Where its text starts */
  start: number;
}

/**
 * The clause keywords in a query, in the order written: exact uppercase, as whole words, outside
 * double quotes (the only quotes the lexer reads, without escapes). SELECT opens a query or is a
 * word like any other.
 * @param input - The query, trimmed
 */
function findClauses(input: string): Clause[] {
  const found: Clause[] = [];
  let inQuote = false;
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '"') inQuote = !inQuote;
    if (inQuote || (i > 0 && !/\s/.test(input[i - 1]))) continue;
    const name = CLAUSES.find((clause) => input.startsWith(clause, i));
    if (!name || (name === 'SELECT' && i > 0)) continue;
    const next = input[i + name.length];
    if (next === undefined || /\s/.test(next) || (name === 'WHERE' && next === '(')) {
      found.push({ name, at: i, start: i + name.length });
    }
  }
  return found;
}

/**
 * Whether search.run hands a query to query.run. Case-sensitive, so "where is login" stays a text
 * search, and a keyword without a field stays text too.
 * @param query - The query
 */
export function hasQueryClauses(query: string): boolean {
  return (
    /^SELECT\b/.test(query) ||
    /\bWHERE\b/.test(query) ||
    /\bGROUP BY\s+\S/.test(query) ||
    /\bORDER BY\s+\S/.test(query)
  );
}

function parseOrderBy(input: string, start: number): OrderByTerm[] {
  const terms: OrderByTerm[] = [];
  const seen = new Set<string>();
  let offset = start;
  for (const part of input.slice(start).split(',')) {
    const position = offset + (part.length - part.trimStart().length);
    offset += part.length + 1;
    const words = part.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) throw new ParseError('ORDER BY expects a field', position);
    if (words.length > 2) {
      throw new ParseError(`Unexpected "${words[2]}" in ORDER BY, expected "," or end`, position);
    }
    const field = words[0].toLowerCase();
    const dirWord = words[1]?.toUpperCase();
    if (dirWord !== undefined && dirWord !== 'ASC' && dirWord !== 'DESC') {
      throw new ParseError(`ORDER BY expects ASC or DESC after "${words[0]}"`, position);
    }
    if (UNSORTABLE_FIELDS.has(field)) {
      throw new ParseError(`${field} cannot be sorted`, position, field);
    }
    if (field.startsWith('cf.')) {
      throw new ParseError('Custom fields cannot be sorted', position, field);
    }
    if (!Object.hasOwn(issueFieldRegistry, field)) {
      throw new ParseError(`Unknown field '${words[0]}' in ORDER BY`, position, field);
    }
    if (seen.has(field)) throw new ParseError(`${field} is sorted twice`, position, field);
    seen.add(field);
    terms.push({ field, dir: dirWord === 'DESC' ? 'desc' : 'asc' });
  }
  return terms;
}

/**
 * A query with optional clauses around its condition:
 * `[SELECT <aggregates>] [WHERE] <condition> [GROUP BY <fields>] [ORDER BY <field> [ASC|DESC], ...]`.
 * The keywords are exact uppercase, so a lowercase "order by" stays the text it always was. After a
 * SELECT the condition needs its WHERE. `select` and `groupBy` are there only if the query has them.
 * @param input - The query
 * @throws {ParseError} For a clause or a where part the grammar has no reading for
 */
export function parseQuery(input: string): ParsedQuery {
  const query = input.trim();
  const clauses = findClauses(query);
  if (clauses.length === 0) return { where: parse(query), orderBy: [] };

  const text: Partial<Record<ClauseName, { text: string; position: number }>> = {};
  clauses.forEach((clause, i) => {
    if (text[clause.name]) {
      throw new ParseError(`${clause.name} appears twice`, clause.at, clause.name);
    }
    const before = clauses[i - 1];
    if (before && CLAUSES.indexOf(before.name) > CLAUSES.indexOf(clause.name)) {
      throw new ParseError(
        `${clause.name} must come before ${before.name}`,
        clause.at,
        clause.name,
      );
    }
    text[clause.name] = {
      text: query.slice(clause.start, clauses[i + 1]?.at ?? query.length),
      position: clause.start,
    };
  });

  const head = query.slice(0, clauses[0].at).trim();
  if (text.WHERE && head !== '') {
    throw new ParseError(`Unexpected "${head}" before WHERE`, 0, head);
  }
  if (text.WHERE && text.WHERE.text.trim() === '') {
    throw new ParseError('WHERE expects a condition', text.WHERE.position);
  }

  const select = text.SELECT && parseSelect(text.SELECT.text, text.SELECT.position);
  const groupBy =
    text['GROUP BY'] && parseGroupBy(text['GROUP BY'].text, text['GROUP BY'].position);
  const orderBy = text['ORDER BY'] ? parseOrderBy(query, text['ORDER BY'].position) : [];
  if (select || groupBy) {
    const stray = orderBy.find((term) => !groupBy?.includes(term.field));
    if (stray) {
      throw new ParseError(
        'ORDER BY in a grouped query takes only fields from GROUP BY',
        text['ORDER BY']?.position ?? 0,
        stray.field,
      );
    }
  }

  const condition = text.WHERE?.text ?? head;
  return {
    where: condition.trim() === '' ? null : parse(condition),
    orderBy,
    ...(select ? { select } : {}),
    ...(groupBy ? { groupBy } : {}),
  };
}
