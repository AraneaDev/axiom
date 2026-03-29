# Query Engine, Automation Upgrades & Template Variables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared query/expression engine that powers structured issue search, upgraded automation conditions/actions, and wiki template variables.

**Architecture:** A standalone `src/lib/query-engine/` module with lexer → parser → AST pipeline. Two backends: AST-to-Prisma compiler (issue search) and AST-to-Boolean evaluator (automation). A separate template expression resolver handles `{{...}}` substitution in automation actions and wiki templates. All three features share the same syntax and function library.

**Tech Stack:** TypeScript, Vitest, Prisma 7, Express 5, React 19, TanStack Query

**Spec:** `docs/superpowers/specs/2026-03-29-query-engine-automation-templates-design.md`

---

## File Structure

### New files (query engine core)
| File | Responsibility |
|------|---------------|
| `src/lib/query-engine/ast.ts` | AST type definitions (Expression, Value, ComparisonOp) |
| `src/lib/query-engine/lexer.ts` | Tokenizer: query string → Token[] |
| `src/lib/query-engine/parser.ts` | Recursive descent parser: Token[] → Expression AST |
| `src/lib/query-engine/compiler.ts` | AST → Prisma `where` clause using field registry |
| `src/lib/query-engine/evaluator.ts` | AST → boolean against a concrete object |
| `src/lib/query-engine/template.ts` | `{{expression}}` resolver for template strings |
| `src/lib/query-engine/functions.ts` | Built-in functions: currentUser, now, empty, etc. |
| `src/lib/query-engine/fields/issue-fields.ts` | Issue field registry |
| `src/lib/query-engine/index.ts` | Public API re-exports |
| `src/lib/query-engine/__tests__/lexer.test.ts` | Lexer unit tests |
| `src/lib/query-engine/__tests__/parser.test.ts` | Parser unit tests |
| `src/lib/query-engine/__tests__/compiler.test.ts` | Compiler unit tests |
| `src/lib/query-engine/__tests__/evaluator.test.ts` | Evaluator unit tests |
| `src/lib/query-engine/__tests__/template.test.ts` | Template resolver unit tests |

### New files (automation)
| File | Responsibility |
|------|---------------|
| `src/modules/automation/webhook.ts` | Webhook action executor with SSRF protection |

### New files (wiki)
| File | Responsibility |
|------|---------------|
| `src/modules/wiki/wiki-template-resolver.controller.ts` | Controller for POST /api/wiki/resolve-template |
| `src/modules/wiki/wiki-template-resolver.service.ts` | Template resolution logic using query-engine/template |
| `frontend/src/components/wiki/TemplateVariablePanel.tsx` | Variable reference sidebar for template editor |

### New files (frontend)
| File | Responsibility |
|------|---------------|
| `frontend/src/components/issues/QueryBar.tsx` | Query language text input with error highlighting |

### Modified files
| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add `condition String?` to AutomationRule, make `conditions Json?` nullable |
| `src/modules/issues/issues.service.ts` | Replace manual WHERE building with query engine pipeline |
| `src/modules/issues/issues.controller.ts` | Accept `q` query param |
| `src/modules/search/search.service.ts` | Replace parseStructuredQuery with query engine for issue search |
| `src/modules/automation/automation.service.ts` | Use query evaluator for conditions, add new actions, template expressions, service layer routing, skipAutomation flag |
| `src/modules/automation/automation.controller.ts` | Validate condition query at creation/update |
| `src/mcp/tools/issue-tools.ts` | Add `query` param to list_issues, route through service layer |
| `src/mcp/tools/wiki-tools.ts` | Add `templateId` param to create_wiki_page |
| `src/modules/wiki/wiki.routes.ts` | Add resolve-template endpoint |
| `src/modules/wiki/blueprints/meeting-notes.ts` | Add template variables |
| `src/modules/wiki/blueprints/retrospective.ts` | Add template variables |
| `src/modules/wiki/blueprints/decision.ts` | Add template variables |
| `src/modules/wiki/blueprints/product-requirements.ts` | Add template variables |
| `src/modules/wiki/blueprints/runbook.ts` | Add template variables |
| `frontend/src/pages/issues/IssueListFilters.tsx` | Add query bar toggle and integration |
| `frontend/src/api/issues.api.ts` | Pass `q` param in list call |
| `frontend/src/api/wiki.api.ts` | Add resolveTemplate API call |
| `frontend/src/pages/wiki/PageEdit.tsx` | Call resolve-template when selecting template |

---

## Task 1: AST Type Definitions

**Files:**
- Create: `src/lib/query-engine/ast.ts`

- [ ] **Step 1: Create src/lib directory**

Run: `mkdir -p src/lib/query-engine/__tests__ src/lib/query-engine/fields`

- [ ] **Step 2: Write AST type definitions**

```typescript
// src/lib/query-engine/ast.ts

export type ComparisonOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | '~';

export type Value =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'function'; name: string; args: Value[] }
  | { type: 'null' };

export type Expression =
  | { type: 'comparison'; field: string; operator: ComparisonOp; value: Value }
  | { type: 'in'; field: string; values: Value[]; negated: boolean }
  | { type: 'and'; left: Expression; right: Expression }
  | { type: 'or'; left: Expression; right: Expression }
  | { type: 'not'; operand: Expression }
  | { type: 'freetext'; value: string };

export interface QueryParseError {
  message: string;
  position: number;
  token?: string;
}

export interface FieldDefinition {
  column: string;
  type: 'enum' | 'string' | 'number' | 'date' | 'relation' | 'user';
  values?: string[];
  ordinal?: boolean;
  join?: string;
  many?: boolean;
  aliasField?: string;
}

export type FieldRegistry = Record<string, FieldDefinition>;

export interface QueryContext {
  currentUserId: string;
  projectId: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/query-engine/ast.ts
git commit -m "feat(query-engine): add AST type definitions"
```

---

## Task 2: Lexer

**Files:**
- Create: `src/lib/query-engine/lexer.ts`
- Test: `src/lib/query-engine/__tests__/lexer.test.ts`

- [ ] **Step 1: Write failing lexer tests**

```typescript
// src/lib/query-engine/__tests__/lexer.test.ts
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
      { type: TokenType.RPAREN, position: 25 },
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
      { type: TokenType.FUNCTION, name: 'now', args: [{ type: 'duration', value: -7, unit: 'd' }], position: 10 },
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
    const andToken = tokens.find(t => t.type === TokenType.AND);
    expect(andToken).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/axiom && npx vitest run src/lib/query-engine/__tests__/lexer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the lexer**

Write `src/lib/query-engine/lexer.ts` implementing:
- `TokenType` enum with: IDENTIFIER, STRING, NUMBER, OPERATOR, AND, OR, NOT, IN, NOT_IN, LPAREN, RPAREN, COMMA, FIELD_VALUE, FUNCTION, FREETEXT
- `Token` type (discriminated union by TokenType)
- `tokenize(input: string): Token[]` function
- Scanning logic:
  - Skip whitespace
  - Recognize `key:value` pattern (FIELD_VALUE), including `key:val1,val2`
  - Recognize quoted strings `"..."` (STRING)
  - Recognize numbers (NUMBER)
  - Recognize operators: `=`, `!=`, `>`, `<`, `>=`, `<=`, `~`
  - Recognize keywords case-insensitively: AND, OR, NOT, IN, NOT IN
  - Recognize `@me` → emit FIELD_VALUE with value `@me`
  - Recognize function calls: `name(args)` with optional duration args `-7d`
  - Everything else → FREETEXT
  - Track position for each token

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /root/axiom && npx vitest run src/lib/query-engine/__tests__/lexer.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/query-engine/lexer.ts src/lib/query-engine/__tests__/lexer.test.ts
git commit -m "feat(query-engine): implement lexer with tests"
```

---

## Task 3: Parser

**Files:**
- Create: `src/lib/query-engine/parser.ts`
- Test: `src/lib/query-engine/__tests__/parser.test.ts`

- [ ] **Step 1: Write failing parser tests**

```typescript
// src/lib/query-engine/__tests__/parser.test.ts
import { describe, it, expect } from 'vitest';
import { parse } from '../parser';
import type { Expression } from '../ast';

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
      // Should parse as: Bug OR (High AND InProgress)
      expect(ast.type).toBe('or');
      expect((ast as any).right.type).toBe('and');
    });

    it('respects parentheses', () => {
      const ast = parse('(type = Bug OR type = Task) AND priority = High');
      expect(ast.type).toBe('and');
      expect((ast as any).left.type).toBe('or');
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
      } catch (e: any) {
        expect(e.position).toBeDefined();
        expect(e.message).toContain('Unexpected');
      }
    });

    it('throws for unmatched parentheses', () => {
      expect(() => parse('(type = Bug')).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/axiom && npx vitest run src/lib/query-engine/__tests__/parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the parser**

Write `src/lib/query-engine/parser.ts` implementing:
- `parse(input: string): Expression` — public entry point
- Internal recursive descent with operator precedence: NOT > AND > OR
- Simple mode detection: if tokens are all FIELD_VALUE/FREETEXT, use simple parsing (implicit AND)
- Complex mode: standard recursive descent with `parseOr()` → `parseAnd()` → `parseNot()` → `parsePrimary()`
- `parsePrimary()`: handles comparisons, IN/NOT IN, parenthesized groups, function calls
- FIELD_VALUE tokens desugared: `key:val` → comparison `=`, `key:a,b` → IN
- `@me` in FIELD_VALUE value → `{ type: 'function', name: 'currentuser', args: [] }`
- FREETEXT tokens collected and merged into a single freetext node
- All identifiers normalized to lowercase
- Errors throw `QueryParseError` with position

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /root/axiom && npx vitest run src/lib/query-engine/__tests__/parser.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/query-engine/parser.ts src/lib/query-engine/__tests__/parser.test.ts
git commit -m "feat(query-engine): implement recursive descent parser with tests"
```

---

## Task 4: Built-in Functions

**Files:**
- Create: `src/lib/query-engine/functions.ts`

- [ ] **Step 1: Write the functions module**

```typescript
// src/lib/query-engine/functions.ts
import type { QueryContext } from './ast';

export type FunctionResolver = (
  args: any[],
  context: QueryContext
) => string | number | Date | null;

const DURATION_UNITS: Record<string, number> = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

export function parseDuration(arg: { type: 'duration'; value: number; unit: string }): number {
  const multiplier = DURATION_UNITS[arg.unit];
  if (!multiplier) throw new Error(`Unknown duration unit: ${arg.unit}`);
  return arg.value * multiplier;
}

export const builtinFunctions: Record<string, FunctionResolver> = {
  currentuser: (_args, context) => context.currentUserId,

  currentsprint: (_args, context) => {
    // Returns a sentinel string that the compiler/evaluator resolves
    // The compiler looks up the active sprint via Prisma when it encounters this sentinel
    return `__currentSprint__${context.projectId}`;
  },

  now: (args) => {
    const base = Date.now();
    if (args.length > 0 && args[0]?.type === 'duration') {
      return new Date(base + parseDuration(args[0]));
    }
    return new Date(base);
  },

  startofday: () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  },

  startofweek: () => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  },

  empty: () => null,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/query-engine/functions.ts
git commit -m "feat(query-engine): add built-in function resolvers"
```

---

## Task 5: Issue Field Registry

**Files:**
- Create: `src/lib/query-engine/fields/issue-fields.ts`

- [ ] **Step 1: Write the field registry**

```typescript
// src/lib/query-engine/fields/issue-fields.ts
import type { FieldRegistry } from '../ast';

export const issueFieldRegistry: FieldRegistry = {
  type:        { column: 'type', type: 'enum', values: ['TASK', 'BUG', 'STORY', 'EPIC'] },
  status:      { column: 'column.name', type: 'relation', join: 'column' },
  priority:    { column: 'priority', type: 'enum', values: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'], ordinal: true },
  assignee:    { column: 'assigneeId', type: 'user', aliasField: 'assignee.username' },
  creator:     { column: 'creatorId', type: 'user', aliasField: 'creator.username' },
  label:       { column: 'labels.name', type: 'relation', join: 'labels', many: true },
  sprint:      { column: 'sprintId', type: 'relation', aliasField: 'sprint.name' },
  project:     { column: 'projectId', type: 'relation', aliasField: 'project.key' },
  storypoints: { column: 'storyPoints', type: 'number' },
  created:     { column: 'createdAt', type: 'date' },
  updated:     { column: 'updatedAt', type: 'date' },
  duedate:     { column: 'dueDate', type: 'date' },
  number:      { column: 'number', type: 'number' },
  title:       { column: 'title', type: 'string' },
};

// Priority ordinal values for > < comparisons (higher index = higher priority)
export const PRIORITY_ORDINALS: Record<string, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/query-engine/fields/issue-fields.ts
git commit -m "feat(query-engine): add issue field registry"
```

---

## Task 6: AST-to-Prisma Compiler

**Files:**
- Create: `src/lib/query-engine/compiler.ts`
- Test: `src/lib/query-engine/__tests__/compiler.test.ts`

- [ ] **Step 1: Write failing compiler tests**

```typescript
// src/lib/query-engine/__tests__/compiler.test.ts
import { describe, it, expect } from 'vitest';
import { compileToPrisma } from '../compiler';
import { parse } from '../parser';
import { issueFieldRegistry } from '../fields/issue-fields';
import type { QueryContext } from '../ast';

const ctx: QueryContext = { currentUserId: 'user-1', projectId: 'proj-1' };

describe('compiler', () => {
  it('compiles simple equality to Prisma where', () => {
    const ast = parse('type:bug');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ type: 'BUG' });
  });

  it('compiles IN to Prisma where with in', () => {
    const ast = parse('priority:high,critical');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ priority: { in: ['HIGH', 'CRITICAL'] } });
  });

  it('compiles AND to merged where', () => {
    const ast = parse('type:bug priority:high');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({
      AND: [
        { type: 'BUG' },
        { priority: 'HIGH' },
      ],
    });
  });

  it('compiles OR to Prisma OR', () => {
    const ast = parse('type = Bug OR type = Task');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({
      OR: [
        { type: 'BUG' },
        { type: 'TASK' },
      ],
    });
  });

  it('compiles NOT to Prisma NOT', () => {
    const ast = parse('NOT type = Bug');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({
      NOT: { type: 'BUG' },
    });
  });

  it('compiles currentUser() to userId', () => {
    const ast = parse('assignee = currentUser()');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ assigneeId: 'user-1' });
  });

  it('compiles empty() to null check', () => {
    const ast = parse('assignee = empty()');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ assigneeId: null });
  });

  it('compiles != empty() to not null', () => {
    const ast = parse('assignee != empty()');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ assigneeId: { not: null } });
  });

  it('compiles numeric comparison', () => {
    const ast = parse('storyPoints > 5');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ storyPoints: { gt: 5 } });
  });

  it('compiles contains operator', () => {
    const ast = parse('title ~ "login"');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ title: { contains: 'login', mode: 'insensitive' } });
  });

  it('compiles relation field (status via column)', () => {
    const ast = parse('status = "In Progress"');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ column: { name: { equals: 'in progress', mode: 'insensitive' } } });
  });

  it('compiles label (many relation)', () => {
    const ast = parse('label = "frontend"');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ labels: { some: { name: { equals: 'frontend', mode: 'insensitive' } } } });
  });

  it('compiles ordinal comparison on priority', () => {
    const ast = parse('priority > Medium');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ priority: { in: ['HIGH', 'CRITICAL'] } });
  });

  it('throws for unknown field', () => {
    const ast = parse('foo = bar');
    expect(() => compileToPrisma(ast, issueFieldRegistry, ctx)).toThrow('Unknown field');
  });

  it('throws for non-ordinal enum with > operator', () => {
    const ast = parse('type > Bug');
    expect(() => compileToPrisma(ast, issueFieldRegistry, ctx)).toThrow("Cannot use '>'");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/axiom && npx vitest run src/lib/query-engine/__tests__/compiler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the compiler**

Write `src/lib/query-engine/compiler.ts` implementing:
- `compileToPrisma(ast: Expression, registry: FieldRegistry, context: QueryContext): any`
- Recursive walk of AST nodes:
  - `comparison`: Look up field in registry. Map operator to Prisma (`=` → direct, `!=` → `{ not }`, `>` → `{ gt }`, `<` → `{ lt }`, `>=` → `{ gte }`, `<=` → `{ lte }`, `~` → `{ contains, mode: 'insensitive' }`)
  - `in`: Map to `{ in: [...] }` or `{ notIn: [...] }` for negated
  - `and`: `{ AND: [left, right] }`
  - `or`: `{ OR: [left, right] }`
  - `not`: `{ NOT: compiled_operand }`
  - `freetext`: Generate `to_tsvector`/`to_tsquery` raw SQL clause
- Value resolution: resolve function Values via `builtinFunctions`
- Enum normalization: match value against registry `values` case-insensitively, use the canonical UPPERCASE form
- Ordinal comparison: for fields with `ordinal: true`, convert `> Medium` into `{ in: ['HIGH', 'CRITICAL'] }` using the ordinal index
- Relation fields: use `{ join: { name: ... } }` for single relations, `{ join: { some: { name: ... } } }` for many relations
- User fields: resolve against `column` (ID) or `aliasField` (username lookup)
- Error handling: throw descriptive errors for unknown fields and type mismatches

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /root/axiom && npx vitest run src/lib/query-engine/__tests__/compiler.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/query-engine/compiler.ts src/lib/query-engine/__tests__/compiler.test.ts
git commit -m "feat(query-engine): implement AST-to-Prisma compiler with tests"
```

---

## Task 7: AST-to-Boolean Evaluator

**Files:**
- Create: `src/lib/query-engine/evaluator.ts`
- Test: `src/lib/query-engine/__tests__/evaluator.test.ts`

- [ ] **Step 1: Write failing evaluator tests**

```typescript
// src/lib/query-engine/__tests__/evaluator.test.ts
import { describe, it, expect } from 'vitest';
import { evaluate } from '../evaluator';
import { parse } from '../parser';
import { issueFieldRegistry } from '../fields/issue-fields';
import type { QueryContext } from '../ast';

const ctx: QueryContext = { currentUserId: 'user-1', projectId: 'proj-1' };

const issue = {
  type: 'BUG',
  priority: 'HIGH',
  storyPoints: 5,
  title: 'Fix login bug',
  number: 42,
  assigneeId: 'user-1',
  assignee: { id: 'user-1', username: 'tim', displayName: 'Tim', email: 'tim@test.com' },
  creator: { id: 'user-2', username: 'jane', displayName: 'Jane', email: 'jane@test.com' },
  creatorId: 'user-2',
  labels: [{ name: 'frontend' }, { name: 'urgent' }],
  sprint: { id: 'sprint-1', name: 'Sprint 1', goal: null },
  sprintId: 'sprint-1',
  column: { id: 'col-1', name: 'In Progress' },
  project: { id: 'proj-1', name: 'Axiom', key: 'AXM' },
  projectId: 'proj-1',
  createdAt: new Date('2026-03-01'),
  updatedAt: new Date('2026-03-29'),
  dueDate: null,
};

describe('evaluator', () => {
  it('evaluates simple equality', () => {
    expect(evaluate(parse('type = Bug'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('type = Task'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates IN', () => {
    expect(evaluate(parse('type IN (Bug, Task)'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('type IN (Task, Story)'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates NOT IN', () => {
    expect(evaluate(parse('type NOT IN (Task, Story)'), issue, issueFieldRegistry, ctx)).toBe(true);
  });

  it('evaluates AND', () => {
    expect(evaluate(parse('type = Bug AND priority = High'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('type = Bug AND priority = Low'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates OR', () => {
    expect(evaluate(parse('type = Task OR priority = High'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('type = Task OR priority = Low'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates NOT', () => {
    expect(evaluate(parse('NOT type = Task'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('NOT type = Bug'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates numeric comparison', () => {
    expect(evaluate(parse('storyPoints > 3'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('storyPoints > 5'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates contains', () => {
    expect(evaluate(parse('title ~ "login"'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('title ~ "signup"'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates currentUser()', () => {
    expect(evaluate(parse('assignee = currentUser()'), issue, issueFieldRegistry, ctx)).toBe(true);
  });

  it('evaluates empty()', () => {
    expect(evaluate(parse('dueDate = empty()'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('assignee = empty()'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates label (many relation)', () => {
    expect(evaluate(parse('label = "frontend"'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('label = "backend"'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates status (relation)', () => {
    expect(evaluate(parse('status = "In Progress"'), issue, issueFieldRegistry, ctx)).toBe(true);
  });

  it('evaluates ordinal priority comparison', () => {
    expect(evaluate(parse('priority > Medium'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('priority > High'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates simple mode query', () => {
    expect(evaluate(parse('type:bug priority:high'), issue, issueFieldRegistry, ctx)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/axiom && npx vitest run src/lib/query-engine/__tests__/evaluator.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the evaluator**

Write `src/lib/query-engine/evaluator.ts` implementing:
- `evaluate(ast: Expression, obj: Record<string, any>, registry: FieldRegistry, context: QueryContext): boolean`
- Recursive walk matching the compiler's structure but evaluating against a concrete object:
  - `comparison`: Extract field value from obj (using registry column/aliasField for path resolution), resolve function Values, compare with operator
  - `in`: Check if field value is in the values array
  - `and`: `left && right`
  - `or`: `left || right`
  - `not`: `!operand`
  - `freetext`: Always returns true (free text filtering happens at Prisma level, not in-memory)
- Value extraction: traverse dot-paths (`column.name`), handle arrays for `many` relations (`labels` → check `some`)
- Enum matching: case-insensitive
- Ordinal comparison: use PRIORITY_ORDINALS for > < on priority

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /root/axiom && npx vitest run src/lib/query-engine/__tests__/evaluator.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/query-engine/evaluator.ts src/lib/query-engine/__tests__/evaluator.test.ts
git commit -m "feat(query-engine): implement AST-to-Boolean evaluator with tests"
```

---

## Task 8: Template Expression Resolver

**Files:**
- Create: `src/lib/query-engine/template.ts`
- Test: `src/lib/query-engine/__tests__/template.test.ts`

- [ ] **Step 1: Write failing template tests**

```typescript
// src/lib/query-engine/__tests__/template.test.ts
import { describe, it, expect } from 'vitest';
import { resolveTemplate } from '../template';

describe('template resolver', () => {
  const context = {
    issue: {
      number: 42,
      title: 'Fix login',
      priority: 'HIGH',
      assignee: { username: 'tim', displayName: 'Tim', email: 'tim@test.com' },
      labels: ['frontend', 'urgent'],
      column: { name: 'In Progress' },
      project: { name: 'Axiom', key: 'AXM' },
    },
    trigger: 'issue:created',
    actor: { username: 'jane', displayName: 'Jane', email: 'jane@test.com' },
  };

  it('resolves simple dot-path', () => {
    expect(resolveTemplate('Issue #{{issue.number}}', context)).toBe('Issue #42');
  });

  it('resolves nested dot-path', () => {
    expect(resolveTemplate('Assigned to {{issue.assignee.displayName}}', context)).toBe('Assigned to Tim');
  });

  it('resolves multiple expressions', () => {
    expect(resolveTemplate('{{issue.number}}: {{issue.title}}', context)).toBe('42: Fix login');
  });

  it('resolves unresolvable path to empty string', () => {
    expect(resolveTemplate('{{issue.nonexistent}}', context)).toBe('');
  });

  it('resolves null value to empty string', () => {
    const ctx = { ...context, issue: { ...context.issue, assignee: null } };
    expect(resolveTemplate('{{issue.assignee.displayName}}', ctx)).toBe('');
  });

  it('leaves text without expressions unchanged', () => {
    expect(resolveTemplate('No expressions here', context)).toBe('No expressions here');
  });

  it('resolves now() function', () => {
    const result = resolveTemplate('{{now()}}', context);
    // Should be a date string, not empty
    expect(result).toBeTruthy();
    expect(result).not.toBe('{{now()}}');
  });

  it('resolves array values by joining', () => {
    expect(resolveTemplate('Labels: {{issue.labels}}', context)).toBe('Labels: frontend, urgent');
  });

  it('handles empty template', () => {
    expect(resolveTemplate('', context)).toBe('');
  });

  it('handles adjacent expressions', () => {
    expect(resolveTemplate('{{issue.project.key}}-{{issue.number}}', context)).toBe('AXM-42');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/axiom && npx vitest run src/lib/query-engine/__tests__/template.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the template resolver**

Write `src/lib/query-engine/template.ts` implementing:
- `resolveTemplate(template: string, context: Record<string, any>): string`
- Find all `{{...}}` blocks via regex `/\{\{(.+?)\}\}/g`
- For each match:
  - Check if it's a function call (contains `()`): resolve via `builtinFunctions`
  - Otherwise: traverse the dot-path on the context object
  - If value is null/undefined: return empty string
  - If value is an array: join with `, `
  - Otherwise: convert to string
- Replace each `{{...}}` with the resolved value

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /root/axiom && npx vitest run src/lib/query-engine/__tests__/template.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/query-engine/template.ts src/lib/query-engine/__tests__/template.test.ts
git commit -m "feat(query-engine): implement template expression resolver with tests"
```

---

## Task 9: Public API Index

**Files:**
- Create: `src/lib/query-engine/index.ts`

- [ ] **Step 1: Write the index file**

```typescript
// src/lib/query-engine/index.ts
export { parse } from './parser';
export { compileToPrisma } from './compiler';
export { evaluate } from './evaluator';
export { resolveTemplate } from './template';
export { builtinFunctions } from './functions';
export { issueFieldRegistry, PRIORITY_ORDINALS } from './fields/issue-fields';
export type {
  Expression,
  Value,
  ComparisonOp,
  QueryParseError,
  FieldDefinition,
  FieldRegistry,
  QueryContext,
} from './ast';
```

- [ ] **Step 2: Run all query engine tests**

Run: `cd /root/axiom && npx vitest run src/lib/query-engine/`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/query-engine/index.ts
git commit -m "feat(query-engine): add public API index"
```

---

## Task 10: Integrate Query Engine into Issue Search

**Files:**
- Modify: `src/modules/issues/issues.controller.ts` (add `q` param extraction)
- Modify: `src/modules/issues/issues.service.ts` (replace manual WHERE building, lines ~209-276)

- [ ] **Step 1: Read current files**

Read `src/modules/issues/issues.controller.ts` and `src/modules/issues/issues.service.ts` (lines 200-320) to understand the current `listIssues` implementation.

- [ ] **Step 2: Add `q` param to controller**

In `issues.controller.ts`, extract `q` from `req.query` alongside existing params and pass it to the service.

- [ ] **Step 3: Refactor `listIssues` in service**

In `issues.service.ts`, replace the manual WHERE clause building with:

```typescript
import { parse, compileToPrisma } from '../../lib/query-engine';
import { issueFieldRegistry } from '../../lib/query-engine/fields/issue-fields';

// In listIssues():
const queryContext = { currentUserId: userId, projectId };
let where: any = { projectId };

if (filters.q) {
  const ast = parse(filters.q);
  const compiled = compileToPrisma(ast, issueFieldRegistry, queryContext);
  where = { ...where, ...compiled };
} else if (hasIndividualFilters(filters)) {
  // Convert individual params to query string for backwards compat
  const q = paramsToQuery(filters);
  if (q) {
    const ast = parse(q);
    const compiled = compileToPrisma(ast, issueFieldRegistry, queryContext);
    where = { ...where, ...compiled };
  }
}
```

Add helper `paramsToQuery(filters)` that converts `{ type: 'BUG', priority: 'HIGH' }` → `'type:bug priority:high'`.

- [ ] **Step 4: Run existing issue tests**

Run: `cd /root/axiom && npx vitest run src/modules/issues/`
Expected: All existing tests PASS (backwards compatible)

- [ ] **Step 5: Commit**

```bash
git add src/modules/issues/issues.controller.ts src/modules/issues/issues.service.ts
git commit -m "feat(issues): integrate query engine into issue search"
```

---

## Task 11: Integrate Query Engine into Cross-Product Search

**Files:**
- Modify: `src/modules/search/search.service.ts` (replace parseStructuredQuery, lines ~79-129)

- [ ] **Step 1: Read current search service**

Read `src/modules/search/search.service.ts` lines 79-200 to understand the current parsing and search flow.

- [ ] **Step 2: Replace parseStructuredQuery with query engine**

In `searchIssues()`, replace the custom tokenizer with the query engine:

```typescript
import { parse, compileToPrisma } from '../../lib/query-engine';
import { issueFieldRegistry } from '../../lib/query-engine/fields/issue-fields';

// Replace parseStructuredQuery usage:
const ast = parse(query);
const compiled = compileToPrisma(ast, issueFieldRegistry, { currentUserId: userId, projectId });
// Merge compiled where with existing scope/FTS clauses
```

Keep the `toTsQuery()` function for FTS — it handles the freetext AST nodes via the compiler.

- [ ] **Step 3: Run search tests**

Run: `cd /root/axiom && npx vitest run src/modules/search/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/modules/search/search.service.ts
git commit -m "feat(search): replace custom tokenizer with query engine"
```

---

## Task 12: Add `query` Param to MCP `list_issues` Tool

**Files:**
- Modify: `src/mcp/tools/issue-tools.ts` (refactor list_issues to use service layer, add query param)

- [ ] **Step 1: Read current list_issues implementation**

Read `src/mcp/tools/issue-tools.ts` lines 18-66 to understand current implementation.

- [ ] **Step 2: Refactor to call service layer**

Replace the direct Prisma query in `list_issues` with a call to `issuesService.listIssues()`, passing individual filter params or the new `query` string. Add `query: z.string().optional()` to the Zod schema.

```typescript
import * as issuesService from '../../modules/issues/issues.service';

// In list_issues handler:
const { issues, total } = await issuesService.listIssues(params.projectId, {
  q: params.query,
  type: params.type,
  priority: params.priority,
  assigneeId: params.assigneeId,
  take: params.limit,
  skip: 0, // MCP uses cursor-based, adapt as needed
}, userId);
```

- [ ] **Step 3: Verify MCP tool still works**

Run: `cd /root/axiom && npx vitest run src/mcp/` (if MCP tests exist, otherwise manual verification)

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools/issue-tools.ts
git commit -m "feat(mcp): add query param to list_issues, route through service layer"
```

---

## Task 13: Prisma Schema Migration for Automation

**Files:**
- Modify: `prisma/schema.prisma` (AutomationRule model)

- [ ] **Step 1: Read current AutomationRule model**

Read `prisma/schema.prisma` lines 1019-1031.

- [ ] **Step 2: Update schema**

Add `condition String?` field and make `conditions` nullable:

```prisma
model AutomationRule {
  id         String   @id @default(cuid())
  projectId  String
  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name       String
  trigger    String
  condition  String?    // Query string (new format)
  conditions Json?      // Deprecated JSON format (was non-nullable)
  actions    Json
  enabled    Boolean  @default(true)
  createdAt  DateTime @default(now())

  @@map("automation_rules")
}
```

- [ ] **Step 3: Generate and apply migration**

Run: `cd /root/axiom && npx prisma migrate dev --name add-automation-condition-string`
Expected: Migration created and applied successfully

- [ ] **Step 4: Write data migration script**

Create a script (or add to seed) that converts existing `conditions` JSON to `condition` strings:

```typescript
// In a migration script or one-time task
const rules = await prisma.automationRule.findMany({ where: { condition: null, conditions: { not: null } } });
for (const rule of rules) {
  const conditions = rule.conditions as any[];
  const parts = conditions.map(c => {
    const op = { equals: '=', not_equals: '!=', in: 'IN', not_in: 'NOT IN', contains: '~' }[c.operator] || '=';
    if (op === 'IN' || op === 'NOT IN') {
      return `${c.field} ${op} (${(c.values || []).join(', ')})`;
    }
    return `${c.field} ${op} ${c.value}`;
  });
  await prisma.automationRule.update({
    where: { id: rule.id },
    data: { condition: parts.join(' AND '), conditions: null },
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(automation): add condition string field, deprecate conditions JSON"
```

---

## Task 14: Upgrade Automation Service — Conditions

**Files:**
- Modify: `src/modules/automation/automation.service.ts` (replace matchesConditions, update evaluateRules)

- [ ] **Step 1: Read current automation service**

Read `src/modules/automation/automation.service.ts` fully.

- [ ] **Step 2: Define AUTOMATION_ISSUE_INCLUDE constant**

Add at top of file:

```typescript
import { evaluate, parse } from '../../lib/query-engine';
import { issueFieldRegistry } from '../../lib/query-engine/fields/issue-fields';

export const AUTOMATION_ISSUE_INCLUDE = {
  assignee: { select: { id: true, username: true, displayName: true, email: true } },
  creator: { select: { id: true, username: true, displayName: true, email: true } },
  labels: { select: { name: true } },
  sprint: { select: { id: true, name: true, goal: true } },
  column: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, key: true } },
} as const;
```

- [ ] **Step 3: Update evaluateRules signature and condition evaluation**

```typescript
interface AutomationContext {
  issue: any; // Hydrated issue with AUTOMATION_ISSUE_INCLUDE
  actorId: string;
  from?: string;
  to?: string;
  label?: string;
  automationDepth?: number;
  issueCreationCount?: number; // Per-event counter: max 1 create_issue across all matching rules
}

export async function evaluateRules(
  projectId: string,
  trigger: string,
  context: AutomationContext,
  options?: { skipAutomation?: boolean }
) {
  if (options?.skipAutomation || (context.automationDepth ?? 0) > 0) return;

  const rules = await prisma.automationRule.findMany({
    where: { projectId, trigger, enabled: true },
  });

  for (const rule of rules) {
    const matches = matchesCondition(rule, context);
    if (matches) {
      await executeActions(projectId, rule.actions as any[], context);
    }
  }
}

function matchesCondition(rule: any, context: AutomationContext): boolean {
  // New format: condition string
  if (rule.condition) {
    const ast = parse(rule.condition);
    return evaluate(ast, context.issue, issueFieldRegistry, {
      currentUserId: context.actorId,
      projectId: context.issue.projectId,
    });
  }
  // Legacy format: conditions JSON (fallback during migration)
  if (rule.conditions) {
    return matchesConditionsLegacy(rule.conditions as any[], context);
  }
  // No conditions = always matches
  return true;
}
```

Keep the old `matchesConditions` logic renamed to `matchesConditionsLegacy` for the migration period.

- [ ] **Step 4: Add condition validation to create/update**

In `createRule` and `updateRule`, validate the condition string:

```typescript
if (data.condition) {
  try {
    parse(data.condition);
  } catch (e: any) {
    throw new AppError(400, `Invalid condition: ${e.message}`);
  }
}
```

- [ ] **Step 5: Run automation tests**

Run: `cd /root/axiom && npx vitest run src/modules/automation/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/automation/automation.service.ts src/modules/automation/automation.controller.ts
git commit -m "feat(automation): use query engine for condition evaluation"
```

---

## Task 15: Upgrade Automation Service — New Actions + Template Expressions

**Files:**
- Modify: `src/modules/automation/automation.service.ts` (add new actions, template resolution)
- Create: `src/modules/automation/webhook.ts` (webhook executor with SSRF protection)

- [ ] **Step 1: Add template expression resolution to executeActions**

```typescript
import { resolveTemplate } from '../../lib/query-engine';

async function buildTemplateContext(context: AutomationContext) {
  const { issue, actorId } = context;
  // Look up the actual actor (the user who triggered the event)
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { username: true, displayName: true, email: true },
  });
  return {
    issue: {
      ...issue,
      labels: issue.labels?.map((l: any) => l.name) ?? [],
    },
    trigger: context.from ? 'issue:status_changed' : 'issue:created',
    from: context.from,
    to: context.to,
    label: context.label,
    actor: actor ?? { username: 'system', displayName: 'System', email: '' },
  };
}
```

- [ ] **Step 2: Refactor existing actions to use service layer**

Replace raw Prisma calls with service calls, threading `skipAutomation: true`:

```typescript
import * as issuesService from '../issues/issues.service';

// set_status action (moveIssue signature: projectId, issueNumber, columnId, position):
case 'set_status':
  await issuesService.moveIssue(context.issue.projectId, context.issue.number, action.columnId, 0, { skipAutomation: true });
  break;

// set_assignee action (updateIssue signature: projectId, issueNumber, data, userId):
case 'set_assignee':
  await issuesService.updateIssue(context.issue.projectId, context.issue.number, { assigneeId: action.userId }, context.actorId, { skipAutomation: true });
  break;
```

- [ ] **Step 3: Add new actions**

```typescript
// set_field action (updateIssue signature: projectId, issueNumber, data, userId):
case 'set_field': {
  const value = resolveTemplate(String(action.value), templateCtx);
  await issuesService.updateIssue(context.issue.projectId, context.issue.number, { [action.field]: value }, context.actorId, { skipAutomation: true });
  break;
}

// create_issue action (createIssue signature: projectId, creatorId, data):
// Guard: track creations per trigger event via context counter, max 1 across all rules
case 'create_issue': {
  if ((context.automationDepth ?? 0) > 0) break;
  if (context.issueCreationCount && context.issueCreationCount >= 1) break;
  const title = resolveTemplate(action.title, templateCtx);
  const targetProjectId = action.projectId || context.issue.projectId;
  await issuesService.createIssue(targetProjectId, context.actorId, {
    title,
    type: action.type || 'TASK',
    assigneeId: action.assigneeId,
  }, { skipAutomation: true });
  context.issueCreationCount = (context.issueCreationCount ?? 0) + 1;
  break;
}

// send_email action:
case 'send_email': {
  const to = resolveTemplate(action.to, templateCtx);
  const subject = resolveTemplate(action.subject, templateCtx);
  const body = resolveTemplate(action.body, templateCtx);
  await emailQueue.add('automation-email', { to, subject, body, type: 'automation' });
  break;
}

// add_comment action (now with template):
case 'add_comment': {
  const body = resolveTemplate(action.body, templateCtx);
  // existing comment creation logic with resolved body
  break;
}
```

- [ ] **Step 4: Implement webhook action with SSRF protection**

Write `src/modules/automation/webhook.ts`:

```typescript
import { URL } from 'url';
import dns from 'dns/promises';

const BLOCKED_RANGES = [
  /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^127\./, /^0\./, /^169\.254\./, /^::1$/, /^fc/, /^fd/, /^fe80/,
];

export async function executeWebhook(url: string, data: any, method = 'POST', headers?: Record<string, string>) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URLs must use HTTPS');
  }

  const addresses = await dns.resolve4(parsed.hostname);
  for (const addr of addresses) {
    if (BLOCKED_RANGES.some(r => r.test(addr))) {
      throw new Error('Webhook URL resolves to a private/internal IP');
    }
  }

  await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(10000),
  });
}
```

- [ ] **Step 5: Add webhook case to executeActions**

```typescript
case 'webhook': {
  const url = resolveTemplate(action.url, templateCtx);
  await executeWebhook(url, templateCtx, action.method, action.headers);
  break;
}
```

- [ ] **Step 6: Run automation tests**

Run: `cd /root/axiom && npx vitest run src/modules/automation/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/automation/automation.service.ts src/modules/automation/webhook.ts
git commit -m "feat(automation): add new actions (set_field, create_issue, send_email, webhook) with template expressions"
```

---

## Task 16: Update Automation Trigger Sites

**Files:**
- Modify: `src/modules/issues/issues.service.ts` (update evaluateRules calls to pass hydrated issue + actorId, fix label:added diffing)
- Modify: `src/modules/issues/issue-board.service.ts` (update moveIssueToColumn trigger site)

- [ ] **Step 1: Read trigger sites**

Read `src/modules/issues/issues.service.ts` lines 130-140 (createIssue trigger) and lines 420-450 (updateIssue triggers). Read `src/modules/issues/issue-board.service.ts` for moveIssueToColumn trigger.

- [ ] **Step 2: Update createIssue trigger site**

After creating an issue, re-fetch with AUTOMATION_ISSUE_INCLUDE and pass to evaluateRules:

```typescript
import { AUTOMATION_ISSUE_INCLUDE } from '../automation/automation.service';

// After prisma.issue.create():
const hydrated = await prisma.issue.findUnique({
  where: { id: issue.id },
  include: AUTOMATION_ISSUE_INCLUDE,
});
evaluateRules(projectId, 'issue:created', { issue: hydrated, actorId: userId }).catch(console.error);
```

- [ ] **Step 3: Update updateIssue trigger site and fix label:added**

For label changes, diff before/after and only fire `label:added` for genuinely added labels:

```typescript
// Before update, fetch current labels:
const beforeLabels = await prisma.issue.findUnique({
  where: { id: issueId },
  select: { labels: { select: { name: true } } },
});
const beforeLabelNames = new Set(beforeLabels?.labels.map(l => l.name) ?? []);

// After update:
const hydrated = await prisma.issue.findUnique({
  where: { id: issueId },
  include: AUTOMATION_ISSUE_INCLUDE,
});

// Fire label:added only for new labels
const afterLabelNames = hydrated.labels.map((l: any) => l.name);
for (const name of afterLabelNames) {
  if (!beforeLabelNames.has(name)) {
    evaluateRules(projectId, 'label:added', { issue: hydrated, actorId: userId, label: name }).catch(console.error);
  }
}
```

- [ ] **Step 4: Update moveIssueToColumn trigger site**

Pass hydrated issue and actorId.

- [ ] **Step 5: Add skipAutomation support to service methods**

Add optional `options` parameter to `updateIssue`, `createIssue`, `moveIssueToColumn`:

```typescript
export async function updateIssue(issueId: string, data: any, options?: { skipAutomation?: boolean }) {
  // ... existing logic ...
  if (!options?.skipAutomation) {
    evaluateRules(projectId, trigger, context).catch(console.error);
  }
}
```

- [ ] **Step 6: Run issue tests**

Run: `cd /root/axiom && npx vitest run src/modules/issues/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/issues/issues.service.ts src/modules/issues/issue-board.service.ts
git commit -m "feat(automation): update trigger sites with hydrated issues, actorId, and label diffing"
```

---

## Task 17: Wiki Template Resolution Endpoint

**Files:**
- Create: `src/modules/wiki/wiki-template-resolver.service.ts`
- Create: `src/modules/wiki/wiki-template-resolver.controller.ts`
- Modify: `src/modules/wiki/wiki.routes.ts` (add resolve-template route)

- [ ] **Step 1: Write the template resolver service**

```typescript
// src/modules/wiki/wiki-template-resolver.service.ts
import { resolveTemplate } from '../../lib/query-engine';
import { prisma } from '../../config/database';

interface ResolveContext {
  teamId: string;
  spaceId: string;
  projectId?: string;
  userId: string;
}

export async function resolveWikiTemplate(body: string, context: ResolveContext): Promise<string> {
  const [user, space] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: context.userId }, select: { username: true, displayName: true, email: true } }),
    prisma.wikiSpace.findUniqueOrThrow({
      where: { id: context.spaceId },
      select: { name: true, key: true, team: { select: { name: true, slug: true } } },
    }),
  ]);

  let project = undefined;
  if (context.projectId) {
    project = await prisma.project.findUnique({
      where: { id: context.projectId },
      select: { name: true, key: true },
    });
  }

  const templateContext = {
    currentUser: user,
    team: space.team,
    space: { name: space.name, key: space.key },
    project: project ?? undefined,
  };

  return resolveTemplate(body, templateContext);
}
```

- [ ] **Step 2: Write the controller**

```typescript
// src/modules/wiki/wiki-template-resolver.controller.ts
import { asyncHandler } from '../../utils/async-handler';
import { resolveWikiTemplate } from './wiki-template-resolver.service';

export const resolveTemplate = asyncHandler(async (req, res) => {
  const { body, context } = req.body;
  const resolved = await resolveWikiTemplate(body, {
    ...context,
    userId: req.user!.id,
  });
  res.json({ body: resolved });
});
```

- [ ] **Step 3: Add route**

In `wiki.routes.ts`, add:

```typescript
import { resolveTemplate } from './wiki-template-resolver.controller';

router.post('/wiki/resolve-template', authenticate, resolveTemplate);
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/wiki/wiki-template-resolver.service.ts src/modules/wiki/wiki-template-resolver.controller.ts src/modules/wiki/wiki.routes.ts
git commit -m "feat(wiki): add template variable resolution endpoint"
```

---

## Task 18: Update Built-in Blueprints

**Files:**
- Modify: `src/modules/wiki/blueprints/meeting-notes.ts`
- Modify: `src/modules/wiki/blueprints/retrospective.ts`
- Modify: `src/modules/wiki/blueprints/decision.ts`
- Modify: `src/modules/wiki/blueprints/product-requirements.ts`
- Modify: `src/modules/wiki/blueprints/runbook.ts`

- [ ] **Step 1: Read all 5 blueprint files**

Read each blueprint to identify static placeholders like `[Date]`, `[Name]`, `[Team]`.

- [ ] **Step 2: Update each blueprint with template variables**

Replace static placeholders with `{{expression}}` syntax:
- `[Date]` → `{{now("MMMM D, YYYY")}}`
- `[Name]` / `[Facilitator]` → `{{currentUser.displayName}}`
- `[Team]` → `{{team.name}}`
- `[Project]` → `{{project.name}}`
- `[Space]` → `{{space.name}}`

- [ ] **Step 3: Commit**

```bash
git add src/modules/wiki/blueprints/
git commit -m "feat(wiki): add template variables to built-in blueprints"
```

---

## Task 19: Add `templateId` to MCP `create_wiki_page` Tool

**Files:**
- Modify: `src/mcp/tools/wiki-tools.ts`

- [ ] **Step 1: Read current create_wiki_page**

Read `src/mcp/tools/wiki-tools.ts` lines 62-92.

- [ ] **Step 2: Add templateId parameter**

```typescript
// Add to Zod schema:
templateId: z.string().optional().describe('Create page from template with auto-resolved variables'),

// In handler, before creating page:
let pageBody = params.body ?? '';
if (!params.body && params.templateId) {
  const template = await prisma.pageTemplate.findUnique({ where: { id: params.templateId } });
  if (template) {
    pageBody = await resolveWikiTemplate(template.body, {
      teamId, spaceId: params.spaceId, userId,
    });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools/wiki-tools.ts
git commit -m "feat(mcp): add templateId param to create_wiki_page with variable resolution"
```

---

## Task 20: Frontend — Query Bar Component

**Files:**
- Create: `frontend/src/components/issues/QueryBar.tsx`
- Modify: `frontend/src/api/issues.api.ts` (pass `q` param)

- [ ] **Step 1: Read existing filter component**

Read `frontend/src/pages/issues/IssueListFilters.tsx` to understand the current layout and props.

- [ ] **Step 2: Write QueryBar component**

```typescript
// frontend/src/components/issues/QueryBar.tsx
import { useState, useCallback } from 'react';
import { Search, X, Code } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

interface QueryBarProps {
  value: string;
  onChange: (query: string) => void;
  error?: { message: string; position: number } | null;
}

export function QueryBar({ value, onChange, error }: QueryBarProps) {
  const [focused, setFocused] = useState(false);

  return (
    <div className={cn(
      'flex items-center gap-2 rounded-md border px-3 py-1.5',
      'border-[var(--color-border)]',
      focused && 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]',
      error && 'border-[var(--color-danger)]',
    )}>
      <Code className="h-4 w-4 shrink-0 text-[var(--color-text-tertiary)]" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="type:bug priority:high OR storyPoints > 5"
        className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none"
      />
      {value && (
        <Button variant="ghost" size="sm" title="Clear query" onClick={() => onChange('')}>
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
      {error && (
        <span className="text-xs text-[var(--color-danger)]">{error.message}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update issues API to pass `q` param**

In `frontend/src/api/issues.api.ts`, update the `list` method to accept and pass `q`:

```typescript
list: (projectId: string, params?: Record<string, string>) => {
  // params can now include { q: 'type:bug ...' }
  const query = params ? '?' + new URLSearchParams(params).toString() : '';
  return get<{ issues: Issue[]; total: number }>(`/projects/${projectId}/issues${query}`);
},
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/issues/QueryBar.tsx frontend/src/api/issues.api.ts
git commit -m "feat(frontend): add QueryBar component and q param support"
```

---

## Task 21: Frontend — Integrate Query Bar into Issue List

**Files:**
- Modify: `frontend/src/pages/issues/IssueListFilters.tsx`

- [ ] **Step 1: Read current filter component**

Read `frontend/src/pages/issues/IssueListFilters.tsx` fully.

- [ ] **Step 2: Add query mode toggle**

Add a toggle between "filter mode" (dropdowns) and "query mode" (text input):

```typescript
import { QueryBar } from '@/components/issues/QueryBar';

// In component:
const [queryMode, setQueryMode] = useState(false);
const [queryString, setQueryString] = useState('');

// When query changes, update URL params:
const handleQueryChange = useCallback((q: string) => {
  setQueryString(q);
  // Debounce and call onQueryChange prop
}, []);

// Render:
// Show toggle button (Code icon) in filter bar header
// When queryMode: show QueryBar, hide dropdown filters
// When !queryMode: show dropdown filters as before
```

- [ ] **Step 3: Sync dropdown filters to query string**

When user changes a dropdown filter in filter mode, update the query string representation. When user types in query mode, sync back to dropdowns if the query is simple enough.

- [ ] **Step 4: Store query in URL search params**

Use `useSearchParams` from react-router to persist the query string in the URL.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/issues/IssueListFilters.tsx
git commit -m "feat(frontend): integrate QueryBar with filter mode toggle"
```

---

## Task 22: Frontend — Wiki Template Variable Resolution

**Files:**
- Modify: `frontend/src/api/wiki.api.ts` (add resolveTemplate call)
- Modify: `frontend/src/pages/wiki/PageEdit.tsx` (call resolveTemplate on template selection)

- [ ] **Step 1: Add resolveTemplate API call**

In `frontend/src/api/wiki.api.ts`:

```typescript
resolveTemplate: (body: string, context: { teamId: string; spaceId: string; projectId?: string }) =>
  post<{ body: string }>('/wiki/resolve-template', { body, context }),
```

- [ ] **Step 2: Update template selection in PageEdit**

In `frontend/src/pages/wiki/PageEdit.tsx`, when user clicks a template, call resolveTemplate before populating the editor:

```typescript
// Replace: setBody(tpl.body)
// With:
const { body: resolved } = await wikiApi.resolveTemplate(tpl.body, {
  teamId, spaceId, projectId,
});
setBody(resolved);
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/wiki.api.ts frontend/src/pages/wiki/PageEdit.tsx
git commit -m "feat(frontend): resolve template variables on template selection"
```

---

## Task 23: Frontend — Template Variable Reference Panel

**Files:**
- Create: `frontend/src/components/wiki/TemplateVariablePanel.tsx`
- Modify: `frontend/src/pages/wiki/PageEdit.tsx` (show panel in template editor)

- [ ] **Step 1: Write the variable reference panel**

```typescript
// frontend/src/components/wiki/TemplateVariablePanel.tsx
import { User, Users, BookOpen, Calendar, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';

const VARIABLE_GROUPS = [
  {
    label: 'User',
    icon: User,
    variables: [
      { name: '{{currentUser.displayName}}', description: 'Your display name' },
      { name: '{{currentUser.username}}', description: 'Your username' },
      { name: '{{currentUser.email}}', description: 'Your email' },
    ],
  },
  {
    label: 'Team & Space',
    icon: Users,
    variables: [
      { name: '{{team.name}}', description: 'Team name' },
      { name: '{{space.name}}', description: 'Wiki space name' },
      { name: '{{project.name}}', description: 'Project name (if in project context)' },
      { name: '{{project.key}}', description: 'Project key (e.g., AXM)' },
    ],
  },
  {
    label: 'Date & Time',
    icon: Calendar,
    variables: [
      { name: '{{now("MMMM D, YYYY")}}', description: 'Current date (e.g., March 29, 2026)' },
      { name: '{{now("YYYY-MM-DD")}}', description: 'Current date ISO format' },
      { name: '{{now("HH:mm")}}', description: 'Current time' },
    ],
  },
];

interface TemplateVariablePanelProps {
  onInsert: (variable: string) => void;
}

export function TemplateVariablePanel({ onInsert }: TemplateVariablePanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ User: true, 'Team & Space': true, 'Date & Time': true });

  return (
    <div className="w-64 border-l border-[var(--color-border)] p-3 space-y-3">
      <h3 className="text-sm font-medium text-[var(--color-text-primary)]">Template Variables</h3>
      {VARIABLE_GROUPS.map(group => {
        const Icon = group.icon;
        const isExpanded = expanded[group.label] ?? true;
        return (
          <div key={group.label}>
            <button
              onClick={() => setExpanded(e => ({ ...e, [group.label]: !isExpanded }))}
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] w-full"
            >
              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <Icon className="h-3.5 w-3.5" />
              {group.label}
            </button>
            {isExpanded && (
              <div className="mt-1 space-y-1 pl-5">
                {group.variables.map(v => (
                  <button
                    key={v.name}
                    onClick={() => onInsert(v.name)}
                    className="block w-full text-left text-xs hover:bg-[var(--color-bg-hover)] rounded px-1.5 py-1"
                    title={v.description}
                  >
                    <code className="text-[var(--color-primary)]">{v.name}</code>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Integrate panel into PageEdit for custom template creation**

In `frontend/src/pages/wiki/PageEdit.tsx`, show the panel when editing a template (detected by URL or prop). Wire `onInsert` to insert text at editor cursor position.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/wiki/TemplateVariablePanel.tsx frontend/src/pages/wiki/PageEdit.tsx
git commit -m "feat(frontend): add template variable reference panel"
```

---

## Task 24: Typecheck and Lint

**Files:** All modified files

- [ ] **Step 1: Run backend typecheck**

Run: `cd /root/axiom && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run frontend typecheck**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run linter**

Run: `cd /root/axiom && npm run check`
Expected: PASS

- [ ] **Step 4: Fix any issues found**

- [ ] **Step 5: Commit fixes if any**

```bash
git add -A
git commit -m "fix: resolve typecheck and lint issues"
```

---

## Task 25: Integration Testing

**Files:**
- Modify: `src/modules/automation/automation.test.ts` (add tests for new condition format and actions)

- [ ] **Step 1: Add integration tests for query-based automation conditions**

```typescript
it('should evaluate query string conditions', async () => {
  // Create a rule with condition string
  const res = await request(app)
    .post(`/api/projects/${projectId}/automation-rules`)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Requested-With', 'XMLHttpRequest')
    .send({
      name: 'High priority bug alert',
      trigger: 'issue:created',
      condition: 'type = Bug AND priority IN (High, Critical)',
      actions: [{ type: 'add_label', name: 'needs-triage' }],
    });
  expect(res.status).toBe(201);
  expect(res.body.condition).toBe('type = Bug AND priority IN (High, Critical)');
});

it('should reject invalid condition syntax', async () => {
  const res = await request(app)
    .post(`/api/projects/${projectId}/automation-rules`)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Requested-With', 'XMLHttpRequest')
    .send({
      name: 'Bad rule',
      trigger: 'issue:created',
      condition: 'type = AND =',
      actions: [],
    });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Add integration tests for issue query search**

```typescript
it('should filter issues using query string', async () => {
  const res = await request(app)
    .get(`/api/projects/${projectId}/issues?q=type:bug`)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Requested-With', 'XMLHttpRequest');
  expect(res.status).toBe(200);
  // Verify only BUG type issues returned
});
```

- [ ] **Step 3: Run all tests**

Run: `cd /root/axiom && npm run test`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/modules/automation/automation.test.ts
git commit -m "test: add integration tests for query engine, automation, and template features"
```

---

## Task 26: Final Verification

- [ ] **Step 1: Run full check suite**

Run: `cd /root/axiom && npm run check`
Expected: All pass (typecheck + lint + format + test)

- [ ] **Step 2: Verify dev stack works**

Run: `cd /root/axiom && npm run docker:dev` then test:
- Issue list with `?q=type:bug` URL param
- Automation rule creation with condition string
- Wiki template creation from blueprint (variables should resolve)

- [ ] **Step 3: Verify MCP tools**

Test `list_issues` with `query` parameter and `create_wiki_page` with `templateId` parameter via the MCP interface.
