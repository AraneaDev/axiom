export const retrospective = {
  name: 'Retrospective',
  description: 'Sprint retrospective with what went well, improvements, and action items',
  body: `## Sprint [N] Retrospective

**Date:** {{now()}}
**Facilitator:** {{currentUser.displayName}}
**Team:** {{team.name}}

### What went well

### What could be improved

### Action items
- [Owner] - [Action] - [Due Date]
`,
};
