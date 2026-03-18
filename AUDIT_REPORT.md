# Axiom Codebase Audit Report

**Date:** 2026-03-18
**Audited by:** 5 parallel agents (security, design, backend, tooling, docs)

---

## 1. Security Findings

### HIGH

| Issue | Location | Details |
|-------|----------|---------|
| XSS in FileView | `frontend/src/pages/repos/FileView.tsx` | Raw file content rendered without sanitization |
| Token storage in localStorage | `frontend/src/api/client.ts` | Access/refresh tokens in localStorage are vulnerable to XSS theft. Consider httpOnly cookies |

### MEDIUM

| Issue | Location | Details |
|-------|----------|---------|
| No CSRF protection | Backend globally | State-changing endpoints lack CSRF tokens. Mitigated partially by JWT auth but still exploitable |
| Missing rate limiting on some routes | Various controllers | Auth routes have rate limiting, but some data-mutation endpoints do not |

### LOW

| Issue | Location | Details |
|-------|----------|---------|
| CORS permissive in dev | `src/index.ts` | Verify CORS is locked down for production |
| No Content-Security-Policy | Backend | Helmet is used but CSP headers should be explicitly configured |

---

## 2. Design Consistency Findings

### PASS (No violations)
- No emojis found anywhere in source
- Lucide icons only (no foreign icon libraries)
- All imports use `react-router` (not `react-router-dom`)
- API client abstraction properly used (no direct `fetch()` in components)
- Shared components follow `forwardRef` + `cn()` pattern

### VIOLATIONS

| Issue | Count | Details |
|-------|-------|---------|
| Native `<button>` without `<Button>` component | 29 elements across 9 files | `IssueList.tsx`, `CreateBranchModal.tsx`, `IssueLinkModal.tsx`, `IssueDevelopmentCard.tsx`, `PageView.tsx`, `PipelineRunDetail.tsx`, `CreateReleaseModal.tsx`, `PipelinesTab.tsx` |
| Hardcoded Tailwind color | 1 | `Login.tsx:56` uses `text-indigo-200` instead of design token |

---

## 3. Backend Architecture Findings

### CRITICAL

| Issue | Location | Details |
|-------|----------|---------|
| Unvalidated PATCH endpoint | `src/modules/projects/projects.controller.ts` | `updateProject()` accepts raw `req.body` without Zod schema validation |
| Missing team authorization on wiki routes | `src/modules/wiki/` | Wiki endpoints don't verify team membership |
| Inconsistent error handling | Multiple controllers | Some use `AppError`, others throw raw errors or return inconsistent status codes |

### MODERATE

| Issue | Location | Details |
|-------|----------|---------|
| Missing pagination on some list endpoints | Various | Some list endpoints return all records without limit/offset |
| Incomplete Prisma includes | Various queries | Some issue queries missing full `project.team.org` relationship chain |

---

## 4. Code Quality Tooling

### Currently Installed

| Tool | Backend | Frontend |
|------|---------|----------|
| ESLint | Yes (flat config, `@eslint/js` + `typescript-eslint`) | **NO** |
| Prettier | Yes (`.prettierrc`) | Yes (inherits root) |
| TypeScript strict | Yes | Yes |
| Vitest | Yes | Yes |
| Playwright | Yes (root) | N/A |
| Coverage | `@vitest/coverage-v8` | No |

### Missing (Now Being Installed)

| Tool | Purpose |
|------|---------|
| `eslint` + `typescript-eslint` (frontend) | Lint frontend code |
| `eslint-plugin-react-hooks` | Enforce Rules of Hooks |
| `eslint-plugin-react-refresh` | Ensure proper Fast Refresh |
| `eslint-plugin-jsdoc` | Enforce JSDoc on exported functions |
| `eslint-plugin-import-x` | Import sorting and validation |
| `husky` | Git hooks |
| `lint-staged` | Run linters on staged files only |
| `@commitlint/cli` + `@commitlint/config-conventional` | Enforce conventional commits |

---

## 5. Documentation Gaps

| Priority | Item | Status |
|----------|------|--------|
| **P0** | README.md with setup/architecture/quickstart | MISSING |
| **P0** | API documentation (REST endpoints + schemas) | MISSING |
| **P1** | Deployment guide (prod setup, env vars) | MISSING |
| **P1** | Contributing guide + code style | MISSING |
| **P2** | JSDoc/TSDoc on exported functions | MINIMAL |
| **P2** | Component gallery (Storybook) | MISSING |
| **P2** | Architecture decision records (ADRs) | MISSING |
| **P3** | CHANGELOG.md | MISSING |
| **P3** | LICENSE file | MISSING |
| **P3** | .env.example | MISSING |

---

## Summary

- **Security:** 2 high, 2 medium, 2 low issues. No SQL injection risk (Prisma ORM). Auth fundamentals are solid.
- **Design:** 95% compliant with CLAUDE.md rules. 29 native buttons need migration to `<Button>` component, 1 hardcoded color.
- **Backend:** 3 critical issues around input validation, authorization, and error handling consistency.
- **Tooling:** Backend has decent setup. Frontend has zero linting. No git hooks, no commit conventions, no CI/CD pipeline.
- **Docs:** Almost no documentation exists outside CLAUDE.md. README, API docs, and deployment guide are critical gaps.
