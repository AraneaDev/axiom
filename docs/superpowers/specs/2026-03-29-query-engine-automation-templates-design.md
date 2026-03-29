# Integrated Query Engine, Automation Upgrades & Template Variables

**Date:** 2026-03-29
**Status:** Draft
**Scope:** Tier 1 features — shared query/expression engine powering issue search, automation conditions, and wiki template variables

---

## 1. Overview

Three features designed as an integrated system sharing a common query/expression engine:

1. **Query Language** — Hybrid syntax (GitHub-style simple, JQL-style complex) for structured issue search
2. **Automation Upgrades** — Query-based conditions, 4 new actions, template expressions in action fields
3. **Template Variables** — `{{expression}}` substitution in wiki templates and automation actions

The shared engine lives in `src/lib/query-engine/` and provides:
- A lexer/parser producing an AST
- An AST-to-Prisma compiler (for issue search)
- An AST-to-Boolean evaluator (for automation conditions)
- A template expression resolver (for `{{...}}` substitution)

---

## 2. Query Language

### 2.1 Syntax

**Simple mode** — implicit AND, GitHub-style key:value tokens:
```
type:bug priority:high,critical assignee:@me
```

**Complex mode** — explicit operators, JQL-style:
```
type = Bug AND (priority IN (High, Critical) OR storyPoints > 5) AND sprint = currentSprint()
```

The parser detects which mode based on whether it encounters operators. Simple `key:value` tokens are desugared into `key = value` AST nodes internally. Comma-separated values in simple mode desugar to `IN`.

### 2.2 AST Node Types

```typescript
type Expression =
  | { type: 'comparison'; field: string; operator: ComparisonOp; value: Value }
  | { type: 'in'; field: string; values: Value[]; negated: boolean }
  | { type: 'and'; left: Expression; right: Expression }
  | { type: 'or'; left: Expression; right: Expression }
  | { type: 'not'; operand: Expression }
  | { type: 'freetext'; value: string }  // Unstructured text → PostgreSQL FTS

type ComparisonOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | '~'  // ~ = contains (substring match)

type Value =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'function'; name: string; args: Value[] }
  | { type: 'null' }
```

**Note on `~` (contains):** Maps to Prisma `contains` (case-insensitive). Example: `title ~ "login"`. This preserves the existing automation `contains` operator.

### 2.2a Aliases & Case Sensitivity

- **`@me`** — alias for `currentUser()`. The lexer recognizes `@me` as a special token and emits a `currentUser()` function value. Only valid on the right side of a comparison.
- **Case insensitive** — field names, operators (`AND`/`and`), enum values (`Bug`/`bug`/`BUG`), and function names are all case-insensitive. The parser normalizes to lowercase internally. Enum values are matched against the field registry's `values` array case-insensitively.

### 2.2b Free Text

Tokens that don't match `field:value` or `field OPERATOR value` patterns are collected as free text and emitted as a `freetext` AST node (included in the `Expression` union above). Free text is passed to PostgreSQL FTS unchanged. When compiling to Prisma, the compiler generates a `to_tsvector`/`to_tsquery` clause ANDed with the structured conditions.

### 2.2c Duration Offsets

Functions that accept duration offsets use a compact syntax: `now(-7d)`, `now(-2w)`, `now(-3h)`.

Supported units: `m` (minutes), `h` (hours), `d` (days), `w` (weeks). The parser recognizes `-?[0-9]+[mhdw]` as a duration literal and converts to a millisecond offset applied to the function's base datetime.

### 2.3 Built-in Functions

| Function | Returns | Example |
|----------|---------|---------|
| `currentUser()` | Requesting user's ID | `assignee = currentUser()` |
| `currentSprint()` | Active sprint ID | `sprint = currentSprint()` |
| `now()` | Current datetime | `created > now(-7d)` |
| `startOfDay()` | Start of today | `updated >= startOfDay()` |
| `startOfWeek()` | Start of this week | `created >= startOfWeek()` |
| `empty()` | Null check | `assignee = empty()` |

### 2.4 Operator Precedence

`NOT` > `AND` > `OR`, with parentheses for explicit grouping.

### 2.5 Pipeline

```
Query String → Lexer → Token[] → Parser → AST (Expression)
                                              ↓
                                    ┌─────────┴──────────┐
                                    ↓                    ↓
                            AST-to-Prisma         AST-to-Boolean
                            (issue search)       (automation eval)
```

### 2.6 Field Registry (Issues)

```typescript
const issueFieldRegistry: FieldRegistry = {
  type:        { column: 'type', type: 'enum', values: ['TASK','BUG','STORY','EPIC'] },
  status:      { column: 'column.name', type: 'relation', join: 'column' },
  priority:    { column: 'priority', type: 'enum', values: ['CRITICAL','HIGH','MEDIUM','LOW'], ordinal: true },
  assignee:    { column: 'assigneeId', type: 'user', aliasField: 'assignee.username' },
  creator:     { column: 'creatorId', type: 'user', aliasField: 'creator.username' },
  label:       { column: 'labels.name', type: 'relation', join: 'labels', many: true },
  sprint:      { column: 'sprintId', type: 'relation', aliasField: 'sprint.name' },
  project:     { column: 'projectId', type: 'relation', aliasField: 'project.key' },
  storyPoints: { column: 'storyPoints', type: 'number' },
  created:     { column: 'createdAt', type: 'date' },
  updated:     { column: 'updatedAt', type: 'date' },
  dueDate:     { column: 'dueDate', type: 'date' },
  number:      { column: 'number', type: 'number' },
  title:       { column: 'title', type: 'string' },
}
```

The `ordinal: true` flag on priority enables `>` / `<` comparisons (Critical > High > Medium > Low).

The field registry is extensible — adding new queryable fields means adding an entry to this object. Future resource types (wiki pages, PRs) get their own registries.

---

## 3. Issue Search Integration

### 3.1 API Changes

**Endpoint:** `GET /api/projects/:projectId/issues`

New parameter: `q` (query string). When present, it replaces individual filter params.

```
GET /api/projects/abc/issues?q=type:bug+priority:high,critical+assignee:@me
GET /api/projects/abc/issues?q=type+%3D+Bug+AND+storyPoints+>+3
```

Individual params (`type`, `priority`, `assigneeId`, etc.) still work for backwards compatibility — they are internally converted to a simple AND query and fed through the same pipeline.

### 3.2 Service Changes (`issues.service.ts`)

The current `listIssues` method builds WHERE clauses manually from individual params. The new flow:

1. If `q` is present: parse with query engine, compile AST to Prisma `where`
2. If individual params are present (no `q`): convert to equivalent query string, same pipeline
3. Merge with project scoping (`projectId`) which is always applied outside the user query

```typescript
// Before (current)
if (filters.type) where.type = filters.type;
if (filters.priority) where.priority = filters.priority;
// ... 8 more if-blocks

// After
const where = filters.q
  ? compileToPrisma(parse(filters.q), issueFieldRegistry, context)
  : compileToPrisma(paramsToQuery(filters), issueFieldRegistry, context);
```

The `context` object carries `currentUserId` and `projectId` for function resolution.

### 3.3 Cross-Product Search (`search.service.ts`)

The existing search service's 7-field token parser is replaced by the query engine parser for issue searches. The search endpoint's `q` parameter gets parsed once:

- Structured fields → query engine AST → Prisma WHERE
- Remaining free text → PostgreSQL FTS (unchanged)

The existing regex tokenizer is removed; the query engine handles both structured and free-text portions.

### 3.4 MCP Integration

`list_issues` tool (in `src/mcp/tools/issue-tools.ts`) gains an optional `query` parameter:

```typescript
server.tool('list_issues', 'List and filter issues', {
  projectId: z.string(),
  query: z.string().optional(),  // NEW — query language string
  // existing params kept for simple use
  type: z.enum([...]).optional(),
  priority: z.enum([...]).optional(),
  assigneeId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().default(20),
}, async (params) => { ... })
```

When `query` is provided, it takes precedence over individual filter params.

**Important:** The MCP `list_issues` tool currently queries Prisma directly. It must be refactored to call `issuesService.listIssues()` so that query parsing flows through the same pipeline as the REST API. This is a prerequisite for this feature.

### 3.5 Frontend Changes

The `IssueListFilters` component gets a **query bar** — a text input above the existing filters that shows the current filters as a query string. Users can:

- Use the existing dropdown filters (which write to the query bar as `key:value` tokens)
- Type directly in the query bar for complex expressions
- Toggle between "filter mode" (dropdowns) and "query mode" (text input)

The query string is stored in URL search params, so filtered views are shareable and bookmarkable.

---

## 4. Automation Engine Upgrades

### 4.1 Condition Format Change

Current conditions are JSON arrays: `[{ field, operator, value }]`. The new format stores conditions as a query string:

```typescript
// Before
conditions: [
  { field: "priority", operator: "in", values: ["HIGH", "CRITICAL"] },
  { field: "type", operator: "equals", value: "BUG" }
]

// After
condition: 'priority IN (High, Critical) AND type = Bug'
```

The `conditions` JSON array is replaced by a single `condition` string field on `AutomationRule`. The AST-to-Boolean evaluator runs the parsed expression against the issue object when a trigger fires.

### 4.2 Schema Change

```prisma
model AutomationRule {
  // ... existing fields
  condition  String?    // NEW — query string
  conditions Json?      // DEPRECATED — made nullable, kept temporarily for migration
  actions    Json       // Unchanged — action objects now support {{expressions}}
}
```

**Migration (two-phase):**

1. **Schema migration** — Add `condition String?` column. Alter `conditions` from `Json` (non-nullable) to `Json?` (nullable):
   ```sql
   ALTER TABLE "AutomationRule" ADD COLUMN "condition" TEXT;
   ALTER TABLE "AutomationRule" ALTER COLUMN "conditions" DROP NOT NULL;
   ```

2. **Data migration script** — Convert existing JSON conditions to query strings. Operator mapping:
   - `equals` → `=`
   - `not_equals` → `!=`
   - `in` → `IN`
   - `not_in` → `NOT IN`
   - `contains` → `~`
   - Multiple conditions → `AND`

   After conversion, set `conditions = NULL` on migrated rows. The service reads `condition` (string) first; falls back to `conditions` (JSON) if present for any unmigrated rows. The `conditions` column is dropped in a later release after confirming all rows are migrated.

### 4.3 New Actions

| Action | Fields | Description |
|--------|--------|-------------|
| `set_field` | `field`, `value` | Set any issue field (priority, storyPoints, dueDate, type). Value supports template expressions. |
| `create_issue` | `type`, `title`, `projectId?`, `assigneeId?` | Create a child/related issue. Title supports template expressions. |
| `send_email` | `to`, `subject`, `body` | Send via existing email queue. All fields support template expressions. |
| `webhook` | `url`, `method?`, `headers?` | POST issue data to external URL. URL supports template expressions. |

Combined with the existing 4 (`set_status`, `set_assignee`, `add_label`, `add_comment`), that gives 8 actions total.

**Guardrails:**

- **`set_field` recursion prevention:** When `executeActions` calls `updateIssue`, it passes a `skipAutomation: true` flag to prevent the update from re-triggering `evaluateRules`. This flag is threaded through the service call and checked at the top of `evaluateRules`.
- **`webhook` SSRF protection:** Webhook URLs are validated against an allowlist of permitted schemes (`https://` only) and blocked from private/internal IP ranges (RFC 1918, loopback, link-local). The URL is resolved via DNS before the request is made and the resolved IP is checked against the blocklist.
- **`create_issue` guard:** Limited to one issue creation per trigger event (across all matching rules). The created issue does not re-trigger any rules for that event (tracked via an `automationDepth` counter on the execution context; depth > 0 skips all automation).
- **Actions go through the service layer:** All actions (`set_status`, `set_assignee`, `set_field`, `create_issue`, etc.) must call the corresponding service methods (e.g., `issuesService.updateIssue()`) rather than raw Prisma calls. This ensures activity logging, cache invalidation, real-time broadcasting, and `skipAutomation` flag threading all work correctly. The current `executeActions` implementation uses raw Prisma and must be refactored as a prerequisite.
- **Partial execution is acceptable:** Actions execute sequentially without transaction wrapping. If action 3 of 4 fails, actions 1-2 remain committed. This matches the behavior of other automation systems (Jira, GitHub Actions) where partial execution is preferable to all-or-nothing rollback.

### 4.4 Template Expressions in Actions

Actions use `{{expression}}` syntax for dynamic values. The expression evaluator resolves against the automation context:

```typescript
// Automation rule action
{
  type: 'add_comment',
  body: 'Bug {{issue.number}} ({{issue.priority}}) assigned to {{issue.assignee.displayName}} on {{now("MMM D, YYYY")}}'
}

// Resolves to:
'Bug 42 (High) assigned to Tim on Mar 29, 2026'
```

### 4.5 Automation Template Context

```typescript
interface AutomationTemplateContext {
  issue: {
    number: number,
    title: string,
    type: string,
    priority: string,
    storyPoints: number | null,
    assignee: { username: string, displayName: string, email: string } | null,
    creator: { username: string, displayName: string, email: string },
    labels: string[],
    sprint: { name: string, goal: string | null } | null,
    column: { name: string },
    project: { name: string, key: string },
  },
  trigger: string,
  from?: string,
  to?: string,
  label?: string,
  actor: { username: string, displayName: string, email: string },
}
```

### 4.6 Trigger Site Requirements

All automation trigger sites (`createIssue`, `updateIssue`, `moveIssueToColumn`) must pass:
1. A fully hydrated issue (see include below)
2. The acting user's ID (`actorId`) — used to populate `actor` in the template context and as `creatorId` for `create_issue` actions

The `evaluateRules` signature becomes: `evaluateRules(projectId, trigger, context)` where context includes `{ issue, actorId, from?, to?, label? }`.

**Note on `label:added` trigger:** The current code fires this trigger whenever `data.labels` is present in an update, even if labels were removed. This must be fixed: the trigger site should diff the before/after label sets and only fire `label:added` for genuinely added labels, passing each added label name in the context.

A shared Prisma include constant defines the required issue shape:

```typescript
const AUTOMATION_ISSUE_INCLUDE = {
  assignee: { select: { id: true, username: true, displayName: true, email: true } },
  creator: { select: { id: true, username: true, displayName: true, email: true } },
  labels: { select: { name: true } },
  sprint: { select: { id: true, name: true, goal: true } },
  column: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, key: true } },
} as const;
```

If the trigger site already has the issue loaded with a subset of these includes, it re-fetches with the full include before calling `evaluateRules`.

### 4.7 Condition Validation

Automation rule conditions are validated at **creation/update time** — the query string is parsed and compiled to verify it is syntactically valid and references known fields. Invalid conditions are rejected with a 400 error and a message indicating the parse error position.

### 4.8 Expression Evaluator

The template expression parser is lightweight — separate from the query parser but sharing the same function resolution:

1. Find `{{...}}` blocks in the string via regex
2. Parse the expression inside (dot-path traversal + optional function call)
3. Resolve against the context object
4. Replace with the string result; unresolvable expressions render as empty string

---

## 5. Wiki Template Variables

### 5.1 Variable Syntax

Same `{{expression}}` syntax as automation, with a wiki-specific context:

```markdown
# Meeting Notes — {{now("MMMM D, YYYY")}}

**Facilitator:** {{currentUser.displayName}}
**Team:** {{team.name}}
**Project:** {{project.name}}

## Attendees
- {{currentUser.displayName}}

## Agenda
1.

## Action Items
- [ ]
```

### 5.2 Wiki Template Context

```typescript
interface WikiTemplateContext {
  currentUser: { username: string, displayName: string, email: string },
  team: { name: string, slug: string },
  space: { name: string, key: string },
  project?: { name: string, key: string },
  now: Function,
  startOfDay: Function,
  startOfWeek: Function,
  date: Function,
}
```

### 5.3 Resolution Flow

1. User selects template in the picker
2. Frontend sends the template body + context IDs to a new endpoint
3. Backend resolves `{{expressions}}` against the context
4. Resolved markdown is returned and populates the editor
5. User can edit freely before saving

Server-side resolution ensures the expression evaluator lives in one place (shared with automation) and has access to all context data.

**Endpoint:** `POST /api/wiki/resolve-template`

```typescript
// Request
{ body: string, context: { teamId: string, spaceId: string, projectId?: string } }

// Response
{ body: string }  // With {{expressions}} resolved
```

### 5.4 Blueprint Updates

The 5 built-in blueprints are updated to use variables where static placeholders exist:

```typescript
// Before (meeting-notes.ts)
body: '# Meeting Notes\n\n**Date:** [Date]\n**Facilitator:** [Name]\n...'

// After
body: '# Meeting Notes — {{now("MMMM D, YYYY")}}\n\n**Facilitator:** {{currentUser.displayName}}\n...'
```

### 5.5 Template Editor UX

When users create custom templates, a **variable reference panel** (collapsible sidebar) lists available `{{variables}}` grouped by category (User, Team, Space, Date). Clicking a variable inserts it at the cursor position.

No new editor component needed — templates are markdown with `{{...}}` tokens as plain text.

### 5.6 MCP Integration

The `create_wiki_page` tool gains an optional `templateId` parameter:

```typescript
server.tool('create_wiki_page', '...', {
  spaceId: z.string(),
  title: z.string(),
  body: z.string().optional(),
  parentId: z.string().optional(),
  templateId: z.string().optional(),  // NEW — create from template with auto-resolved variables
})
```

When `templateId` is provided, the backend fetches the template, resolves variables using the MCP user context, and creates the page. If both `body` and `templateId` are provided, `body` wins.

---

## 6. Error Handling

### 6.1 Parse Errors

The parser returns structured errors with position information:

```typescript
interface QueryParseError {
  message: string;       // Human-readable: "Unexpected token ')' at position 15"
  position: number;      // Character offset in the query string
  token?: string;        // The problematic token
}
```

The API returns parse errors as 400 responses with the error detail, allowing the frontend to highlight the error position in the query bar.

### 6.2 Runtime Errors

- **Unknown field:** Returns 400 with `"Unknown field 'foo'. Available fields: type, priority, ..."`.
- **Type mismatch:** Returns 400 with `"Cannot use '>' on enum field 'type'. Use '=' or 'IN'."` (unless the field has `ordinal: true`).
- **Function errors:** `currentSprint()` returns null if no active sprint exists — the comparison evaluates to false rather than erroring.
- **Template expression errors:** Unresolvable paths (e.g., `{{issue.nonexistent}}`) render as empty string and log a warning. No user-facing error — templates degrade gracefully.

---

## 7. Module Structure

```
src/lib/query-engine/
├── index.ts              # Public API: parse(), compileToPrisma(), evaluate(), resolveTemplate()
├── lexer.ts              # Tokenizer: string → Token[]
├── parser.ts             # Recursive descent: Token[] → Expression (AST)
├── ast.ts                # AST type definitions
├── compiler.ts           # AST → Prisma where clause (uses field registry)
├── evaluator.ts          # AST → boolean (against concrete object)
├── template.ts           # {{expression}} resolver
├── functions.ts          # Built-in functions: currentUser, now, empty, etc.
├── fields/
│   └── issue-fields.ts   # Issue field registry
└── __tests__/
    ├── lexer.test.ts
    ├── parser.test.ts
    ├── compiler.test.ts
    ├── evaluator.test.ts
    └── template.test.ts
```

---

## 8. Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Integration model | Shared engine | One syntax to learn, one codebase to maintain |
| Query syntax | Hybrid (simple + complex) | Progressive complexity — simple queries stay compact |
| Template scope | Wiki + automation | Covers highest-value use cases without scope creep |
| Query targets | Issues only | 90% of value; extensible via field registries later |
| MCP approach | Enhance existing tools | No tool sprawl; backwards compatible |
| Automation additions | Expressions + 4 new actions | Covers most-requested gaps without loops/branching complexity |
| Saved query refs | No — inline only | Self-documenting rules; easier to debug |
| Architecture | Parser-first (lexer/parser/AST) | Clean foundation; ~300-400 lines; pays dividends across all features |

---

## 9. Out of Scope

- Querying wiki pages, PRs, or repos (future — add field registries)
- Saved filters as named references in queries
- Automation loops/branching (for-each, if/else)
- Automation audit log (valuable but independent feature)
- PR description template variables
- Notification template variables
