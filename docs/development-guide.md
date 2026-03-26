# Development Guide

## Running Locally

```bash
# Start database and services
npm run docker:dev

# Seed demo data
npm run db:seed

# Run backend tests
npm run test:run

# Run frontend type check
cd frontend && npx tsc --noEmit

# Run backend type check
npm run typecheck

# Run e2e tests (requires dev stack running)
npm run e2e
```

## Code Quality

```bash
npm run lint        # ESLint
npm run format      # Prettier
npm run typecheck   # TypeScript
npm run check       # All of the above + tests
```

## Seed Users

| Username | Password | Role |
|----------|----------|------|
| tim | password123 | OWNER |
| test | password123 | MEMBER |

## Design Rules

- No emojis anywhere (use Lucide icons)
- Every button must include a Lucide icon
- Use CSS variable design tokens, never Tailwind palette colors directly
- Abstract repeated UI patterns into shared components

## Git Conventions

- Branch from `master`
- Conventional commit messages: `feat:`, `fix:`, `docs:`, `refactor:`
- All PRs require passing typecheck and lint
