export const decision = {
  name: 'Decision Record',
  description: 'Document a decision with context, options considered, and consequences',
  body: `## Decision: [Title]

**Status:** PROPOSED | ACCEPTED | REJECTED
**Date:** {{now()}}
**Decider:** {{currentUser.displayName}}

### Context
[What is the issue that we're seeing that is motivating this decision?]

### Options Considered
| Option | Pros | Cons |
|--------|------|------|
| A | | |
| B | | |

### Decision
[What is the change that we're proposing and/or doing?]

### Consequences
[What becomes easier or more difficult because of this change?]
`,
};
