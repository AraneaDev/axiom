# Git Integration Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-link branches to issues, smart commits, and a development panel — making the "all-in-one" integration story tangible.

**Architecture:** Extend the existing git post-receive hook handler to detect issue keys in branch names and parse smart commit directives. Add a new aggregation endpoint for the development panel. Frontend adds a unified development activity sidebar on issue detail.

**Tech Stack:** Express, Prisma, existing git hook infrastructure, React, TanStack Query

**Spec:** `docs/superpowers/specs/2026-03-28-high-value-features-design.md` (Features 1, 2, 5)

---

## File Structure

### Backend (new files)
- `src/modules/issues/smart-commits.service.ts` — Parser for smart commit directives
- `src/modules/issues/smart-commits.test.ts` — Unit tests for the parser
- `src/modules/issues/development-panel.service.ts` — Aggregation service for dev panel
- `src/modules/issues/development-panel.controller.ts` — API endpoint for dev panel
- `src/modules/issues/development-panel.test.ts` — Tests for aggregation endpoint

### Backend (modified files)
- `src/git/hook-handler.ts` — Add branch auto-linking and smart commit processing
- `src/modules/issues/issues.routes.ts` — Mount development panel endpoint

### Frontend (new files)
- `frontend/src/api/development-panel.api.ts` — API client for dev panel

### Frontend (modified files)
- `frontend/src/pages/issues/IssueDevelopmentCard.tsx` — Enhance with aggregated data from new endpoint

### Docs (modified files)
- `docs/api-reference.md` — Document new endpoints
- `docs/architecture.md` — Document smart commit flow

---

## Task 1: Smart Commit Parser

**Files:**
- Create: `src/modules/issues/smart-commits.service.ts`
- Create: `src/modules/issues/smart-commits.test.ts`

### Step 1: Write failing tests for the parser

- [ ] Create the test file with cases covering all directives:

```typescript
// src/modules/issues/smart-commits.test.ts
import { describe, it, expect } from 'vitest';
import { parseSmartCommit } from './smart-commits.service';

describe('parseSmartCommit', () => {
  it('extracts issue key from commit message', () => {
    const result = parseSmartCommit('AXM-42 fix login bug');
    expect(result).toEqual([
      { issueKey: 'AXM-42', directives: [] }
    ]);
  });

  it('parses #time directive', () => {
    const result = parseSmartCommit('AXM-42 #time 2h');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [{ type: 'time', value: '2h' }]
      }
    ]);
  });

  it('parses #time with minutes', () => {
    const result = parseSmartCommit('AXM-42 #time 1h30m');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [{ type: 'time', value: '1h30m' }]
      }
    ]);
  });

  it('parses #comment directive', () => {
    const result = parseSmartCommit('AXM-42 #comment Fixed the auth bug');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [{ type: 'comment', value: 'Fixed the auth bug' }]
      }
    ]);
  });

  it('parses #comment stops at next directive', () => {
    const result = parseSmartCommit('AXM-42 #comment Fixed it #resolve');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [
          { type: 'comment', value: 'Fixed it' },
          { type: 'transition', value: 'resolve' }
        ]
      }
    ]);
  });

  it('parses #resolve directive', () => {
    const result = parseSmartCommit('AXM-42 #resolve');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [{ type: 'transition', value: 'resolve' }]
      }
    ]);
  });

  it('parses #close directive', () => {
    const result = parseSmartCommit('AXM-42 #close');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [{ type: 'transition', value: 'close' }]
      }
    ]);
  });

  it('parses #reopen directive', () => {
    const result = parseSmartCommit('AXM-42 #reopen');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [{ type: 'transition', value: 'reopen' }]
      }
    ]);
  });

  it('parses #assign directive', () => {
    const result = parseSmartCommit('AXM-42 #assign tim');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [{ type: 'assign', value: 'tim' }]
      }
    ]);
  });

  it('parses #label directive', () => {
    const result = parseSmartCommit('AXM-42 #label frontend');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [{ type: 'label', value: 'frontend' }]
      }
    ]);
  });

  it('parses multiple directives', () => {
    const result = parseSmartCommit('AXM-42 #time 2h #comment Fixed the auth bug #resolve');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [
          { type: 'time', value: '2h' },
          { type: 'comment', value: 'Fixed the auth bug' },
          { type: 'transition', value: 'resolve' }
        ]
      }
    ]);
  });

  it('parses multiple issue keys', () => {
    const result = parseSmartCommit('AXM-42 AXM-43 #resolve');
    expect(result).toEqual([
      { issueKey: 'AXM-42', directives: [{ type: 'transition', value: 'resolve' }] },
      { issueKey: 'AXM-43', directives: [{ type: 'transition', value: 'resolve' }] }
    ]);
  });

  it('returns empty array for no issue keys', () => {
    const result = parseSmartCommit('just a regular commit message');
    expect(result).toEqual([]);
  });

  it('handles issue key with no directives', () => {
    const result = parseSmartCommit('fix AXM-42 login timeout');
    expect(result).toEqual([
      { issueKey: 'AXM-42', directives: [] }
    ]);
  });
});

describe('parseTimeDuration', () => {
  it('parses hours', () => {
    expect(parseTimeDuration('2h')).toBe(120);
  });

  it('parses minutes', () => {
    expect(parseTimeDuration('30m')).toBe(30);
  });

  it('parses hours and minutes', () => {
    expect(parseTimeDuration('1h30m')).toBe(90);
  });

  it('returns 0 for invalid input', () => {
    expect(parseTimeDuration('abc')).toBe(0);
  });
});
```

- [ ] Run tests to verify they fail:

```bash
npx vitest run src/modules/issues/smart-commits.test.ts
```

Expected: FAIL — module not found

### Step 2: Implement the smart commit parser

- [ ] Create the parser:

```typescript
// src/modules/issues/smart-commits.service.ts

export interface SmartCommitDirective {
  type: 'time' | 'comment' | 'transition' | 'assign' | 'label';
  value: string;
}

export interface SmartCommitResult {
  issueKey: string;
  directives: SmartCommitDirective[];
}

const ISSUE_KEY_PATTERN = /[A-Z]+-\d+/g;
const DIRECTIVE_PATTERN = /#(time|comment|resolve|close|reopen|assign|label)\s*/gi;

export function parseSmartCommit(message: string): SmartCommitResult[] {
  const issueKeys = [...new Set(message.match(ISSUE_KEY_PATTERN) || [])];
  if (issueKeys.length === 0) return [];

  const directives = parseDirectives(message);

  return issueKeys.map(issueKey => ({
    issueKey,
    directives
  }));
}

function parseDirectives(message: string): SmartCommitDirective[] {
  const directives: SmartCommitDirective[] = [];
  const parts = message.split(DIRECTIVE_PATTERN);

  // parts alternates: [prefix, directive_name, value_text, directive_name, value_text, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i].toLowerCase();
    const rawValue = (parts[i + 1] || '').trim();

    if (name === 'time') {
      directives.push({ type: 'time', value: rawValue.split(/\s/)[0] });
    } else if (name === 'comment') {
      directives.push({ type: 'comment', value: rawValue });
    } else if (name === 'resolve' || name === 'close' || name === 'reopen') {
      directives.push({ type: 'transition', value: name });
    } else if (name === 'assign') {
      directives.push({ type: 'assign', value: rawValue.split(/\s/)[0] });
    } else if (name === 'label') {
      directives.push({ type: 'label', value: rawValue.split(/\s/)[0] });
    }
  }

  return directives;
}

export function parseTimeDuration(duration: string): number {
  const hoursMatch = duration.match(/(\d+)h/);
  const minutesMatch = duration.match(/(\d+)m/);
  const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
  const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;
  return hours * 60 + minutes;
}
```

- [ ] Run tests to verify they pass:

```bash
npx vitest run src/modules/issues/smart-commits.test.ts
```

Expected: All PASS

- [ ] Commit:

```bash
git add src/modules/issues/smart-commits.service.ts src/modules/issues/smart-commits.test.ts
git commit -m "feat(issues): add smart commit message parser with directive extraction"
```

---

## Task 2: Smart Commit Execution

**Files:**
- Create: `src/modules/issues/smart-commits.executor.ts` — Executes parsed directives against issues
- Modify: `src/git/hook-handler.ts` — Call executor after parsing commits

### Step 1: Write the executor

- [ ] Create the executor that takes parsed results and applies them:

```typescript
// src/modules/issues/smart-commits.executor.ts
import { prisma } from '../../config/database';
import { parseSmartCommit, parseTimeDuration, SmartCommitResult } from './smart-commits.service';

export async function executeSmartCommit(
  commitMessage: string,
  repoId: string,
  authorUserId: string | null
): Promise<void> {
  const results = parseSmartCommit(commitMessage);
  if (results.length === 0) return;

  for (const result of results) {
    await executeDirectivesForIssue(result, repoId, authorUserId);
  }
}

async function executeDirectivesForIssue(
  result: SmartCommitResult,
  repoId: string,
  authorUserId: string | null
): Promise<void> {
  // Find the issue by key (e.g., "AXM-42" -> prefix "AXM", number 42)
  const match = result.issueKey.match(/^([A-Z]+)-(\d+)$/);
  if (!match) return;

  const [, prefix, numStr] = match;
  const issueNumber = parseInt(numStr, 10);

  const issue = await prisma.issue.findFirst({
    where: {
      number: issueNumber,
      project: { prefix }
    },
    include: {
      project: { include: { columns: true } }
    }
  });

  if (!issue) return;

  for (const directive of result.directives) {
    switch (directive.type) {
      case 'time': {
        const minutes = parseTimeDuration(directive.value);
        if (minutes > 0 && authorUserId) {
          await prisma.timeLog.create({
            data: {
              issueId: issue.id,
              userId: authorUserId,
              minutes,
              description: 'Logged via smart commit',
              loggedAt: new Date()
            }
          });
        }
        break;
      }
      case 'comment': {
        if (directive.value && authorUserId) {
          await prisma.issueComment.create({
            data: {
              issueId: issue.id,
              authorId: authorUserId,
              body: directive.value
            }
          });
        }
        break;
      }
      case 'transition': {
        const columns = issue.project.columns;
        let targetColumn;
        if (directive.value === 'resolve' || directive.value === 'close') {
          targetColumn = columns.find(c => c.isDone);
        } else if (directive.value === 'reopen') {
          targetColumn = columns.find(c => c.isDefault);
        }
        if (targetColumn && targetColumn.id !== issue.columnId) {
          await prisma.issue.update({
            where: { id: issue.id },
            data: { columnId: targetColumn.id }
          });
        }
        break;
      }
      case 'assign': {
        const user = await prisma.user.findFirst({
          where: { username: directive.value }
        });
        if (user) {
          await prisma.issue.update({
            where: { id: issue.id },
            data: { assigneeId: user.id }
          });
        }
        break;
      }
      case 'label': {
        const label = await prisma.label.findFirst({
          where: {
            name: directive.value,
            projectId: issue.projectId
          }
        });
        if (label) {
          await prisma.issueLabel.upsert({
            where: {
              issueId_labelId: { issueId: issue.id, labelId: label.id }
            },
            create: { issueId: issue.id, labelId: label.id },
            update: {}
          });
        }
        break;
      }
    }
  }
}
```

### Step 2: Integrate into the git hook handler

- [ ] Modify `src/git/hook-handler.ts` to call the executor. Find the section after commit linking (around line 195) and add:

```typescript
// After existing commit linking logic in processCommits()
// Import at top of file:
import { executeSmartCommit } from '../modules/issues/smart-commits.executor';

// After the existing commit processing loop, add for each commit:
// Find the user by email if possible
const commitUser = await prisma.user.findFirst({
  where: { email: commit.authorEmail }
});
await executeSmartCommit(commit.message, repoId, commitUser?.id ?? null);
```

The exact integration point is in the `processCommits` function after the existing `IssueCommit` upsert logic.

- [ ] Commit:

```bash
git add src/modules/issues/smart-commits.executor.ts src/git/hook-handler.ts
git commit -m "feat(issues): execute smart commit directives (time, comment, transition, assign, label)"
```

---

## Task 3: Auto-Link Branches to Issues

**Files:**
- Modify: `src/git/hook-handler.ts` — Add branch auto-linking on push

### Step 1: Add branch auto-linking to the hook handler

- [ ] In `src/git/hook-handler.ts`, add a function to auto-link branches to issues. Add this near the existing commit processing:

```typescript
const ISSUE_KEY_IN_BRANCH = /([A-Z]+-\d+)/;

async function autoLinkBranch(ref: string, repoId: string, pusherId: string): Promise<void> {
  // Only process branch refs, not tags
  if (!ref.startsWith('refs/heads/')) return;

  const branchName = ref.replace('refs/heads/', '');
  const match = branchName.match(ISSUE_KEY_IN_BRANCH);
  if (!match) return;

  const issueKey = match[1];
  const keyMatch = issueKey.match(/^([A-Z]+)-(\d+)$/);
  if (!keyMatch) return;

  const [, prefix, numStr] = keyMatch;
  const issueNumber = parseInt(numStr, 10);

  const issue = await prisma.issue.findFirst({
    where: {
      number: issueNumber,
      project: { prefix }
    }
  });

  if (!issue) return;

  // Upsert to avoid duplicates
  await prisma.issueBranch.upsert({
    where: {
      issueId_repoId_branchName: {
        issueId: issue.id,
        repoId,
        branchName
      }
    },
    create: {
      issueId: issue.id,
      repoId,
      branchName,
      createdById: pusherId
    },
    update: {}
  });
}
```

- [ ] Call `autoLinkBranch` from the main post-receive handler, before commit processing:

```typescript
// In the handler, after extracting ref and repoId:
await autoLinkBranch(payload.ref, repoId, userId);
```

- [ ] Commit:

```bash
git add src/git/hook-handler.ts
git commit -m "feat(git): auto-link branches to issues via issue key in branch name"
```

---

## Task 4: Development Panel API Endpoint

**Files:**
- Create: `src/modules/issues/development-panel.service.ts`
- Create: `src/modules/issues/development-panel.controller.ts`
- Modify: `src/modules/issues/issues.routes.ts` — Mount the endpoint

### Step 1: Write the aggregation service

- [ ] Create the service that fetches all development activity for an issue:

```typescript
// src/modules/issues/development-panel.service.ts
import { prisma } from '../../config/database';

export interface DevelopmentSummary {
  branches: Array<{
    id: string;
    repoId: string;
    repoName: string;
    branchName: string;
    createdAt: Date;
  }>;
  commits: Array<{
    id: string;
    repoId: string;
    repoName: string;
    sha: string;
    message: string;
    authorName: string;
    committedAt: Date;
  }>;
  pullRequests: Array<{
    id: string;
    repoId: string;
    repoName: string;
    number: number;
    title: string;
    status: string;
    authorName: string;
    createdAt: Date;
  }>;
  pipelines: Array<{
    id: string;
    repoName: string;
    pipelineName: string;
    status: string;
    ref: string;
    createdAt: Date;
  }>;
}

export async function getDevelopmentSummary(
  projectId: string,
  issueNumber: number
): Promise<DevelopmentSummary> {
  const issue = await prisma.issue.findFirst({
    where: { projectId, number: issueNumber }
  });

  if (!issue) {
    throw new Error('Issue not found');
  }

  const [branches, commits, issuePRs, pipelineRuns] = await Promise.all([
    prisma.issueBranch.findMany({
      where: { issueId: issue.id },
      include: { repo: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.issueCommit.findMany({
      where: { issueId: issue.id },
      include: { repo: { select: { id: true, name: true } } },
      orderBy: { committedAt: 'desc' },
      take: 20
    }),
    prisma.issuePullRequest.findMany({
      where: { issueId: issue.id },
      include: {
        pullRequest: {
          include: {
            repo: { select: { id: true, name: true } },
            author: { select: { displayName: true } }
          }
        }
      }
    }),
    // Get pipeline runs for linked branches
    prisma.issueBranch.findMany({
      where: { issueId: issue.id },
      select: {
        branchName: true,
        repoId: true,
        repo: { select: { name: true } }
      }
    }).then(async (linkedBranches) => {
      if (linkedBranches.length === 0) return [];
      return prisma.pipelineRun.findMany({
        where: {
          OR: linkedBranches.map(b => ({
            pipeline: { repoId: b.repoId },
            ref: b.branchName
          }))
        },
        include: {
          pipeline: {
            select: { name: true, repo: { select: { name: true } } }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      });
    })
  ]);

  return {
    branches: branches.map(b => ({
      id: b.id,
      repoId: b.repo.id,
      repoName: b.repo.name,
      branchName: b.branchName,
      createdAt: b.createdAt
    })),
    commits: commits.map(c => ({
      id: c.id,
      repoId: c.repo.id,
      repoName: c.repo.name,
      sha: c.sha,
      message: c.message,
      authorName: c.authorName,
      committedAt: c.committedAt
    })),
    pullRequests: issuePRs.map(ip => ({
      id: ip.pullRequest.id,
      repoId: ip.pullRequest.repo.id,
      repoName: ip.pullRequest.repo.name,
      number: ip.pullRequest.number,
      title: ip.pullRequest.title,
      status: ip.pullRequest.status,
      authorName: ip.pullRequest.author.displayName,
      createdAt: ip.pullRequest.createdAt
    })),
    pipelines: pipelineRuns.map(r => ({
      id: r.id,
      repoName: r.pipeline.repo.name,
      pipelineName: r.pipeline.name,
      status: r.status,
      ref: r.ref,
      createdAt: r.createdAt
    }))
  };
}
```

### Step 2: Write the controller

- [ ] Create the controller:

```typescript
// src/modules/issues/development-panel.controller.ts
import { Request, Response } from 'express';
import { getDevelopmentSummary } from './development-panel.service';

export async function getDevelopmentPanel(req: Request, res: Response) {
  const { projectId, issueNumber } = req.params;
  const summary = await getDevelopmentSummary(projectId, parseInt(issueNumber, 10));
  res.json(summary);
}
```

### Step 3: Mount the route

- [ ] In `src/modules/issues/issues.routes.ts`, add the route alongside existing branch/commit routes:

```typescript
import { getDevelopmentPanel } from './development-panel.controller';

// Add near existing branch/commit routes (around line 65):
router.get('/:projectId/issues/:issueNumber/development', getDevelopmentPanel);
```

- [ ] Commit:

```bash
git add src/modules/issues/development-panel.service.ts src/modules/issues/development-panel.controller.ts src/modules/issues/issues.routes.ts
git commit -m "feat(issues): add development panel API endpoint aggregating branches, commits, PRs, pipelines"
```

---

## Task 5: Development Panel Frontend

**Files:**
- Create: `frontend/src/api/development-panel.api.ts`
- Modify: `frontend/src/pages/issues/IssueDevelopmentCard.tsx` — Enhance with unified data

### Step 1: Add the API client

- [ ] Create the API client:

```typescript
// frontend/src/api/development-panel.api.ts
import { get } from './client';

export interface DevelopmentSummary {
  branches: Array<{
    id: string;
    repoId: string;
    repoName: string;
    branchName: string;
    createdAt: string;
  }>;
  commits: Array<{
    id: string;
    repoId: string;
    repoName: string;
    sha: string;
    message: string;
    authorName: string;
    committedAt: string;
  }>;
  pullRequests: Array<{
    id: string;
    repoId: string;
    repoName: string;
    number: number;
    title: string;
    status: string;
    authorName: string;
    createdAt: string;
  }>;
  pipelines: Array<{
    id: string;
    repoName: string;
    pipelineName: string;
    status: string;
    ref: string;
    createdAt: string;
  }>;
}

export const developmentPanelApi = {
  getSummary: (projectId: string, issueNumber: number) =>
    get<DevelopmentSummary>(`/projects/${projectId}/issues/${issueNumber}/development`),
};
```

### Step 2: Enhance IssueDevelopmentCard

- [ ] Modify `frontend/src/pages/issues/IssueDevelopmentCard.tsx` to use the new unified endpoint. The component already has expandable sections for Branches, Pull Requests, and Commits. Replace the three separate queries with the single development panel query, and add a Pipelines section:

Key changes:
1. Replace individual `useQuery` calls for branches, commits, PRs with a single `useQuery({ queryKey: ['development-panel', projectId, issueNumber], queryFn: () => developmentPanelApi.getSummary(projectId, issueNumber) })`
2. Add a new expandable "Pipelines" section showing latest build status per branch with status icons (CheckCircle, XCircle, Loader from Lucide)
3. Add pipeline status badge colors using CSS variable tokens (`text-success` for passed, `text-destructive` for failed, `text-warning` for running)
4. Keep existing branch creation UI (the "Create branch" button and form)

- [ ] Commit:

```bash
git add frontend/src/api/development-panel.api.ts frontend/src/pages/issues/IssueDevelopmentCard.tsx
git commit -m "feat(issues): enhance development panel UI with unified data and pipeline status"
```

---

## Task 6: Documentation

**Files:**
- Modify: `docs/api-reference.md`
- Modify: `docs/architecture.md`

### Step 1: Update API reference

- [ ] Add to `docs/api-reference.md` under the Issues section:

```markdown
### Development Panel
- `GET /api/projects/:projectId/issues/:issueNumber/development` — Returns aggregated development activity (branches, commits, PRs, pipelines) for an issue

### Smart Commits
Smart commit directives are processed automatically on `git push`. No API endpoint needed.

**Syntax:** `<ISSUE-KEY> #<directive> <value>`

**Directives:**
- `#time <duration>` — Log time (e.g., `2h`, `30m`, `1h30m`)
- `#comment <text>` — Add comment (text until next `#` directive)
- `#resolve` / `#close` / `#reopen` — Transition issue status
- `#assign <username>` — Reassign issue
- `#label <name>` — Add label

**Example:** `AXM-42 #time 2h #comment Fixed login timeout #resolve`
```

### Step 2: Update architecture doc

- [ ] Add to `docs/architecture.md` in the Git section:

```markdown
### Smart Commits & Auto-Linking
The post-receive hook handler (`src/git/hook-handler.ts`) processes pushes in three stages:
1. **Auto-link branches** — Scans branch name for issue keys (e.g., `feature/AXM-42-fix`), creates `IssueBranch` records
2. **Link commits** — Existing behavior: links commits to issues via `IssueCommit` records
3. **Smart commits** — Parses directives (`#time`, `#comment`, `#resolve`, etc.) and executes them against the referenced issues
```

- [ ] Commit:

```bash
git add docs/api-reference.md docs/architecture.md
git commit -m "docs: add smart commits, auto-link branches, and development panel documentation"
```
