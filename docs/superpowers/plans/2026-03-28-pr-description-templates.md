# PR Description Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-repo Markdown templates that pre-fill PR descriptions on creation, ensuring consistent code review across teams.

**Architecture:** New `prTemplate` text field on Repository model. Repo settings gets a template editor tab. PR creation form pre-fills from template.

**Tech Stack:** Prisma, Express, React, TanStack Query, MarkdownEditor (TipTap)

**Spec:** `docs/superpowers/specs/2026-03-28-high-value-features-design.md` (Feature 6)

---

## File Structure

### Backend (modified files)
- `prisma/schema.prisma` — Add `prTemplate` field to Repository
- `src/modules/repos/repos.service.ts` — Include prTemplate in repo responses

### Frontend (modified files)
- `frontend/src/pages/repos/RepoSettings.tsx` — Add PR Template tab (or create if doesn't exist)
- `frontend/src/pages/repos/PRCreate.tsx` — Pre-fill body from template

---

## Task 1: Database Field

**Files:**
- Modify: `prisma/schema.prisma`

### Step 1: Add prTemplate field

- [ ] Add to the Repository model in `prisma/schema.prisma`:

```prisma
prTemplate String? // Markdown template for PR descriptions
```

### Step 2: Run migration

- [ ] Generate and apply:

```bash
npx prisma migrate dev --name add-pr-template-to-repository
```

- [ ] Commit:

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(repos): add prTemplate field to Repository model"
```

---

## Task 2: Backend — Template CRUD

**Files:**
- Modify: `src/modules/repos/repos.service.ts` — Ensure prTemplate is returned and updatable

### Step 1: Verify prTemplate is included

- [ ] Check `repos.service.ts` — the `updateRepo` method likely already handles arbitrary field updates. Ensure `prTemplate` is included in the allowed update fields. If the service uses explicit field picking, add `prTemplate` to the allowed set.

- [ ] Verify the `getRepo` method returns `prTemplate` in its response (it should if using `findUnique` without explicit `select`).

- [ ] If needed, add `prTemplate` to the repo update validation schema in the controller.

- [ ] Commit:

```bash
git add src/modules/repos/repos.service.ts src/modules/repos/repos.controller.ts
git commit -m "feat(repos): support prTemplate in repo update and response"
```

---

## Task 3: Frontend — Template Editor in Repo Settings

**Files:**
- Modify or create: `frontend/src/pages/repos/RepoSettings.tsx`

### Step 1: Add PR Template tab

- [ ] In the repo settings page, add a new tab "PR Template" (use `FileText` icon from Lucide).

- [ ] The tab contains:
  - A `MarkdownEditor` component pre-loaded with the current `prTemplate` value (or empty)
  - A "Save" button (`Save` icon from Lucide) that calls `reposApi.update(repoId, { prTemplate: value })`
  - Helper text: "This Markdown template will pre-fill the description when creating a new pull request."
  - A "Preview" toggle to see rendered output

- [ ] Use `useMutation` for save with success toast.

- [ ] Commit:

```bash
git add frontend/src/pages/repos/RepoSettings.tsx
git commit -m "feat(repos): add PR template editor tab in repo settings"
```

---

## Task 4: Frontend — Pre-fill PR Description

**Files:**
- Modify: `frontend/src/pages/repos/PRCreate.tsx`

### Step 1: Pre-fill body from template

- [ ] In `PRCreate.tsx`, the component already loads the repo data. Add logic to pre-fill the `body` state with the repo's `prTemplate` if:
  1. The repo has a `prTemplate` (not null/empty)
  2. The user hasn't already typed in the body field

```typescript
// In the component, after loading repo data:
const repo = useRepoData(); // however repo is fetched
useEffect(() => {
  if (repo?.prTemplate && !body) {
    setBody(repo.prTemplate);
  }
}, [repo?.prTemplate]);
```

- [ ] The user can freely edit or clear the pre-filled template.

- [ ] Commit:

```bash
git add frontend/src/pages/repos/PRCreate.tsx
git commit -m "feat(repos): pre-fill PR description from repo template on PR creation"
```

---

## Task 5: Documentation

**Files:**
- Modify: `docs/api-reference.md`

### Step 1: Update docs

- [ ] Add to `docs/api-reference.md` under Repositories:

```markdown
### PR Templates
- `PATCH /api/repos/:repoId` with `{ prTemplate: "## Summary\n..." }` — Set PR description template
- Template is Markdown text pre-filled into the description field when creating a new PR
- Set to `null` to remove the template
```

- [ ] Commit:

```bash
git add docs/api-reference.md
git commit -m "docs: add PR description templates documentation"
```
