export const productRequirements = {
  name: 'Product Requirements',
  description: 'Define goals, user stories, technical requirements, and timeline',
  body: `## Overview
**Author:** {{currentUser.displayName}}
**Date:** {{now()}}
**Project:** {{project.name}}
**Team:** {{team.name}}

[Brief description of the feature]

### Goals
-

### Non-Goals
-

### User Stories
- As a [role], I want [capability] so that [benefit]

### Technical Requirements
-

### Open Questions
-

### Timeline
| Milestone | Date | Status |
|-----------|------|--------|
`,
};
