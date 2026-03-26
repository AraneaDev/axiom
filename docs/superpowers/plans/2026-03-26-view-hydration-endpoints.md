# View Hydration Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-view `/hydrate` endpoints for the 5 heaviest pages to reduce API request waterfall from 7-16 calls down to 1 per view.

**Architecture:** Each view gets a backend hydration service method that does a single entity lookup then fans out all sub-queries via `Promise.allSettled`. The frontend calls this once on mount and seeds React Query's cache for individual query keys, so child components find warm cache. Granular endpoints stay for mutations and fallback.

**Tech Stack:** Express, Prisma, React, TanStack Query, Vitest + Supertest

**Spec:** `docs/superpowers/specs/2026-03-26-view-hydration-endpoints-design.md`

---

## File Structure

### Backend (per view)
- `src/modules/issues/issues-hydrate.service.ts` -- Issue Detail + Issues List hydration
- `src/modules/issues/issues-hydrate.controller.ts` -- Controller for issue hydration endpoints
- `src/modules/issues/issues-hydrate.test.ts` -- Tests for issue hydration
- `src/modules/issues/backlog-hydrate.service.ts` -- Backlog hydration
- `src/modules/issues/backlog-hydrate.controller.ts` -- Controller for backlog hydration
- `src/modules/issues/backlog-hydrate.test.ts` -- Tests for backlog hydration
- `src/modules/pulls/pulls-hydrate.service.ts` -- PR Detail hydration
- `src/modules/pulls/pulls-hydrate.controller.ts` -- Controller for PR hydration
- `src/modules/pulls/pulls-hydrate.test.ts` -- Tests for PR hydration
- `src/modules/wiki/wiki-hydrate.service.ts` -- Wiki Page hydration
- `src/modules/wiki/wiki-hydrate.controller.ts` -- Controller for wiki hydration
- `src/modules/wiki/wiki-hydrate.test.ts` -- Tests for wiki hydration

### Frontend (per view)
- `frontend/src/api/hydrate.api.ts` -- All hydration API functions
- `frontend/src/hooks/useHydration.ts` -- Shared hydration hook with cache-seeding logic
- Modify: `frontend/src/pages/issues/IssueDetail.tsx` -- Integrate hydration
- Modify: `frontend/src/pages/repos/PRDetail.tsx` -- Integrate hydration
- Modify: `frontend/src/pages/issues/IssueList.tsx` -- Integrate hydration
- Modify: `frontend/src/pages/wiki/PageView.tsx` -- Integrate hydration
- Modify: `frontend/src/pages/issues/Backlog.tsx` -- Integrate hydration

### Route Registration
- Modify: `src/modules/issues/issues.routes.ts` -- Add hydrate routes
- Modify: `src/modules/pulls/pulls.routes.ts` -- Add hydrate route
- Modify: `src/modules/wiki/wiki.routes.ts` -- Add hydrate route

---

## Shared Utilities (Task 1)

### Task 1: Create shared `settled` helper and frontend hydration hook

**Files:**
- Create: `src/utils/settled.ts`
- Create: `frontend/src/hooks/useHydration.ts`
- Create: `frontend/src/api/hydrate.api.ts`

- [ ] **Step 1: Create the `settled` helper**

```ts
// src/utils/settled.ts

/**
 * Extract value from a PromiseSettledResult, logging failures.
 */
export function settled<T>(result: PromiseSettledResult<T>, label: string): T | null {
  if (result.status === 'fulfilled') return result.value;
  console.warn(`[hydrate] partial failure in ${label}:`, result.reason);
  return null;
}
```

- [ ] **Step 2: Create the frontend hydration API file (empty, will be populated per task)**

```ts
// frontend/src/api/hydrate.api.ts
import { get } from './client';

// Issue Detail hydration types and functions will be added per task
```

- [ ] **Step 3: Create the `useHydration` hook**

This hook takes a hydration query result and a mapping of cache keys to response fields, and seeds React Query's cache.

```ts
// frontend/src/hooks/useHydration.ts
import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

interface HydrationMapping<T> {
  queryKey: QueryKey;
  field: keyof T;
}

/**
 * Seeds React Query cache from a hydration response.
 * Only seeds non-null fields (null means partial backend failure).
 */
export function useHydrationSeeder<T extends Record<string, unknown>>(
  data: T | undefined,
  mappings: HydrationMapping<T>[],
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!data) return;
    for (const { queryKey, field } of mappings) {
      const value = data[field];
      if (value !== null && value !== undefined) {
        queryClient.setQueryData(queryKey, value);
      }
    }
  }, [data, mappings, queryClient]);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/utils/settled.ts frontend/src/hooks/useHydration.ts frontend/src/api/hydrate.api.ts
git commit -m "feat: add shared hydration utilities (settled helper + useHydrationSeeder hook)"
```

---

## Task 2: Issue Detail Hydration -- Backend

**Files:**
- Create: `src/modules/issues/issues-hydrate.service.ts`
- Create: `src/modules/issues/issues-hydrate.controller.ts`
- Create: `src/modules/issues/issues-hydrate.test.ts`
- Modify: `src/modules/issues/issues.routes.ts`

- [ ] **Step 1: Write the hydration test**

```ts
// src/modules/issues/issues-hydrate.test.ts
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Issue Detail Hydration', () => {
  let token: string;
  let projectId: string;
  let issueNumber: number;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'hydrate-test-user' },
      update: {},
      create: {
        email: 'hydrate-test@axiom.dev',
        username: 'hydrate-test-user',
        displayName: 'Hydrate Test User',
        passwordHash,
      },
    });

    const org = await prisma.organization.create({
      data: {
        name: 'Hydrate Test Org',
        slug: 'hydrate-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });

    const team = await prisma.team.create({
      data: {
        name: 'Hydrate Test Team',
        slug: 'hydrate-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'hydrate-test@axiom.dev', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    // Create project with board columns
    const projRes = await request(app)
      .post(`/api/teams/${team.id}/projects`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Hydrate Project', prefix: 'HYD' });
    projectId = projRes.body.id;

    // Create an issue
    const issueRes = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Hydrate test issue', type: 'TASK' });
    issueNumber = issueRes.body.number;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'hydrate-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'hydrate-test-user' } });
  });

  it('should return all sections in a single response', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues/${issueNumber}/hydrate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('issue');
    expect(res.body).toHaveProperty('votes');
    expect(res.body).toHaveProperty('watchers');
    expect(res.body).toHaveProperty('links');
    expect(res.body).toHaveProperty('children');
    expect(res.body).toHaveProperty('progress');
    expect(res.body).toHaveProperty('development');
    expect(res.body.development).toHaveProperty('branches');
    expect(res.body.development).toHaveProperty('pullRequests');
    expect(res.body.development).toHaveProperty('commits');
    expect(res.body).toHaveProperty('activity');
    expect(res.body).toHaveProperty('attachments');
    expect(res.body).toHaveProperty('worklogs');
    expect(res.body).toHaveProperty('sprints');
    expect(res.body).toHaveProperty('customFields');

    // Verify issue has expected shape
    expect(res.body.issue).toHaveProperty('title', 'Hydrate test issue');
    expect(res.body.issue).toHaveProperty('key');
    expect(res.body.votes).toHaveProperty('count', 0);
    expect(res.body.votes).toHaveProperty('voted', false);
  });

  it('should return 404 for non-existent issue', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues/99999/hydrate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(404);
  });

  it('should require authentication', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues/${issueNumber}/hydrate`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run src/modules/issues/issues-hydrate.test.ts`
Expected: FAIL -- route does not exist yet (404 on hydrate endpoint)

- [ ] **Step 3: Write the hydration service**

The service calls existing sub-service functions. Each sub-service currently takes `(projectId, issueNumber)` and does its own `findIssueOrThrow`. For phase 1, we accept the redundant lookups to avoid modifying existing services. Phase 2 optimization (internal `ById` variants) can come later.

```ts
// src/modules/issues/issues-hydrate.service.ts
import { settled } from '../../utils/settled';
import * as issuesService from './issues.service';
import * as votesService from './issue-votes.service';
import * as watchersService from './issue-watchers.service';
import * as linksService from './issue-links.service';
import * as hierarchyService from './issue-hierarchy.service';
import * as branchesService from './issue-branches.service';
import * as commitsService from './issue-commits.service';
import * as timeService from './issue-time.service';
import * as sprintsService from '../sprints/sprints.service';
import * as customFieldsService from '../custom-fields/custom-fields.service';
import * as activityService from '../activity/activity.service';
import * as attachmentsService from '../attachments/attachments.service';

/**
 * Hydrate all data needed for the Issue Detail view in a single call.
 */
export async function hydrateIssueDetail(
  projectId: string,
  issueNumber: number,
  userId: string,
) {
  // Primary lookup -- if this fails, the whole request 404s
  const issue = await issuesService.getIssue(projectId, issueNumber);

  // Parallel fan-out for all secondary data
  const results = await Promise.allSettled([
    votesService.getVotes(projectId, issueNumber, userId),
    watchersService.getWatchers(projectId, issueNumber),
    linksService.getLinks(projectId, issueNumber),
    hierarchyService.getChildren(projectId, issueNumber),
    issuesService.getEpicProgress(projectId, issueNumber),
    branchesService.getBranches(projectId, issueNumber),
    hierarchyService.getIssuePullRequests(projectId, issueNumber),
    commitsService.getCommits(projectId, issueNumber),
    activityService.listIssueActivity(projectId, issueNumber, { limit: 50 }),
    attachmentsService.listByIssue(issue.id),
    timeService.getWorklogs(projectId, issueNumber),
    sprintsService.list(projectId),
    customFieldsService.listByProject(projectId),
  ]);

  return {
    issue,
    votes: settled(results[0], 'votes'),
    watchers: settled(results[1], 'watchers'),
    links: settled(results[2], 'links'),
    children: settled(results[3], 'children'),
    progress: settled(results[4], 'progress'),
    development: {
      branches: settled(results[5], 'branches'),
      pullRequests: settled(results[6], 'pullRequests'),
      commits: settled(results[7], 'commits'),
    },
    activity: settled(results[8], 'activity'),
    attachments: settled(results[9], 'attachments'),
    worklogs: settled(results[10], 'worklogs'),
    sprints: settled(results[11], 'sprints'),
    customFields: settled(results[12], 'customFields'),
  };
}
```

**Note:** The exact import paths and function names for `activityService.listIssueActivity`, `attachmentsService.listByIssue`, `sprintsService.list`, and `customFieldsService.listByProject` must be verified against the actual module exports. Check:
- `src/modules/activity/activity.service.ts` for the activity list function name
- `src/modules/attachments/attachments.service.ts` for the list-by-issue function name
- `src/modules/sprints/sprints.service.ts` for the list function name
- `src/modules/custom-fields/custom-fields.service.ts` for the list function name

Adjust imports and function calls to match the actual exports.

- [ ] **Step 4: Write the controller**

```ts
// src/modules/issues/issues-hydrate.controller.ts
import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';
import * as hydrateService from './issues-hydrate.service';

/**
 * GET /projects/:projectId/issues/:issueNumber/hydrate
 */
export async function hydrateIssueDetail(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await hydrateService.hydrateIssueDetail(
      param(req, 'projectId'),
      parseInt(param(req, 'issueNumber'), 10),
      req.userId!,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 5: Register the route**

In `src/modules/issues/issues.routes.ts`, add near the top of the issue-specific routes (before `/:projectId/issues/:issueNumber` to avoid param conflicts):

```ts
import * as hydrateController from './issues-hydrate.controller';

// Add this line with the other GET routes for a specific issue
router.get('/:projectId/issues/:issueNumber/hydrate', authenticate, hydrateController.hydrateIssueDetail);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -- --run src/modules/issues/issues-hydrate.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/utils/settled.ts src/modules/issues/issues-hydrate.service.ts src/modules/issues/issues-hydrate.controller.ts src/modules/issues/issues-hydrate.test.ts src/modules/issues/issues.routes.ts
git commit -m "feat: add Issue Detail hydration endpoint (GET /issues/:num/hydrate)"
```

---

## Task 3: Issue Detail Hydration -- Frontend

**Files:**
- Modify: `frontend/src/api/hydrate.api.ts`
- Modify: `frontend/src/pages/issues/IssueDetail.tsx`

- [ ] **Step 1: Add the Issue Detail hydration API function and types**

```ts
// Add to frontend/src/api/hydrate.api.ts
import { get } from './client';

export interface IssueDetailHydration {
  issue: Record<string, unknown>;
  votes: { count: number; voted: boolean } | null;
  watchers: unknown[] | null;
  links: unknown[] | null;
  children: unknown[] | null;
  progress: { total: number; completed: number; inProgress: number; percentage: number } | null;
  development: {
    branches: unknown[] | null;
    pullRequests: unknown[] | null;
    commits: unknown[] | null;
  };
  activity: unknown[] | null;
  attachments: unknown[] | null;
  worklogs: unknown[] | null;
  sprints: unknown[] | null;
  customFields: unknown[] | null;
}

export const hydrateApi = {
  issueDetail: (projectId: string, issueNumber: number) =>
    get<IssueDetailHydration>(`/projects/${projectId}/issues/${issueNumber}/hydrate`),
};
```

**Note:** The types above use `unknown` for brevity. In practice, import and reuse the existing types from `issues.api.ts` and other API files for full type safety. Adjust these types to match the actual return types of each granular endpoint.

- [ ] **Step 2: Integrate hydration into IssueDetail.tsx**

At the top of the `IssueDetail` component, add the hydration query and cache seeding. Then update each existing `useQuery` to add a fallback `enabled` guard.

Add the hydration query:
```tsx
import { hydrateApi } from '@/api/hydrate.api';
import { useHydrationSeeder } from '@/hooks/useHydration';

// Inside the component, before existing useQuery calls:
const hydrationQuery = useQuery({
  queryKey: ['issue-hydrate', currentProject?.id, num],
  queryFn: () => hydrateApi.issueDetail(currentProject!.id, num!),
  enabled: !!currentProject?.id && !!num,
  retry: 1,
  staleTime: 30_000,
});

// Seed individual caches from hydration response
const hydrationMappings = useMemo(() => [
  { queryKey: ['issue', currentProject?.id, num], field: 'issue' as const },
  { queryKey: ['issue-votes', currentProject?.id, num], field: 'votes' as const },
  { queryKey: ['issue-watchers', currentProject?.id, num], field: 'watchers' as const },
  { queryKey: ['issue-links', currentProject?.id, issue?.number], field: 'links' as const },
  { queryKey: ['issue-children', currentProject?.id, issue?.number], field: 'children' as const },
  { queryKey: ['issue-progress', currentProject?.id, issue?.number], field: 'progress' as const },
  { queryKey: ['activity', currentProject?.id, num], field: 'activity' as const },
  { queryKey: ['sprints', currentProject?.id], field: 'sprints' as const },
], [currentProject?.id, num, issue?.number]);

useHydrationSeeder(hydrationQuery.data, hydrationMappings);
```

Then for each existing `useQuery`, add the fallback guard. Example for votes:
```tsx
// Before:
const { data: votes } = useQuery({
  queryKey: ['issue-votes', currentProject?.id, num],
  queryFn: () => issuesApi.getVotes(currentProject!.id, num!),
  enabled: !!currentProject?.id && !!num,
});

// After:
const { data: votes } = useQuery({
  queryKey: ['issue-votes', currentProject?.id, num],
  queryFn: () => issuesApi.getVotes(currentProject!.id, num!),
  enabled: !!currentProject?.id && !!num
    && (hydrationQuery.isError || (hydrationQuery.isSuccess && hydrationQuery.data?.votes === null)),
  staleTime: 30_000,
});
```

Apply this pattern to all useQuery hooks that are covered by hydration:
- `['issue-votes', ...]` -- fallback on `data?.votes === null`
- `['issue-watchers', ...]` -- fallback on `data?.watchers === null`
- `['issue-links', ...]` -- fallback on `data?.links === null`
- `['issue-children', ...]` -- fallback on `data?.children === null`
- `['issue-progress', ...]` -- fallback on `data?.progress === null`
- `['activity', ...]` -- fallback on `data?.activity === null`
- `['sprints', ...]` -- fallback on `data?.sprints === null`

For the `['issue', ...]` query (main issue data), keep it enabled always as it's the critical path fallback.

For development data (branches, PRs, commits) in `IssueDevelopmentCard.tsx`, pass `hydrationQuery` down as a prop or use the seeded cache approach. Seed these keys in the parent:
```tsx
// Additional seeding for development sub-fields
useEffect(() => {
  if (!hydrationQuery.data?.development) return;
  const qc = queryClient;
  const dev = hydrationQuery.data.development;
  if (dev.branches !== null) qc.setQueryData(['issue-branches', currentProject?.id, issue?.number], dev.branches);
  if (dev.pullRequests !== null) qc.setQueryData(['issue-prs', currentProject?.id, issue?.number], dev.pullRequests);
  if (dev.commits !== null) qc.setQueryData(['issue-commits', currentProject?.id, issue?.number], dev.commits);
}, [hydrationQuery.data?.development]);
```

- [ ] **Step 3: Verify the page loads with a single hydration request**

Run: `cd frontend && npm run dev`
Navigate to an issue detail page. Check Network tab:
- Should see 1 `/hydrate` request for issue-specific data
- Context requests (me, orgs, team) still fire separately
- Granular endpoints should NOT fire (unless hydration returns null for a section)

- [ ] **Step 4: Verify mutations still work**

Test: vote on the issue, add a comment, toggle watch. Each mutation should:
- Call the granular mutation endpoint
- Invalidate the relevant query key
- Refetch via the granular GET endpoint (not re-hydrate)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/hydrate.api.ts frontend/src/pages/issues/IssueDetail.tsx frontend/src/hooks/useHydration.ts
git commit -m "feat: integrate Issue Detail hydration on frontend (cache-seeding pattern)"
```

---

## Task 4: PR Detail Hydration -- Backend

**Files:**
- Create: `src/modules/pulls/pulls-hydrate.service.ts`
- Create: `src/modules/pulls/pulls-hydrate.controller.ts`
- Create: `src/modules/pulls/pulls-hydrate.test.ts`
- Modify: `src/modules/pulls/pulls.routes.ts`

- [ ] **Step 1: Write the hydration test**

Follow the same test pattern as Task 2. Test structure:
- Setup: create user, org, team, repo, PR
- Test: `GET /api/repos/:repoId/pulls/:prNumber/hydrate` returns all sections
- Verify response has: `pr`, `mergeChecks`, `diff`, `commits`, `statuses`, `reviews`, `discussions`
- Test 404 for non-existent PR
- Test 401 without auth

**Note:** PR test fixtures are more complex than issues -- creating a PR requires a repo with git history and branches. Check `src/modules/pulls/pulls.test.ts` for the existing test setup pattern (repo creation, git init, branch creation via the git commands utility). Reuse that fixture pattern rather than inventing a new one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run src/modules/pulls/pulls-hydrate.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the hydration service**

```ts
// src/modules/pulls/pulls-hydrate.service.ts
import { settled } from '../../utils/settled';
import * as pullsService from './pulls.service';

/**
 * Hydrate all data needed for the PR Detail view.
 */
export async function hydratePRDetail(repoId: string, prNumber: number) {
  // Primary lookup
  const pr = await pullsService.getPR(repoId, prNumber);

  // Fan out secondary queries
  // Verify exact function names against pulls.service.ts exports:
  // - getMergeChecks / checkMergeability
  // - getDiff
  // - getCommits / listCommits
  // - getStatuses
  // - getReviews / listReviews
  // - getDiscussions / listDiscussions
  const results = await Promise.allSettled([
    pullsService.getMergeChecks(repoId, prNumber),
    pullsService.getDiff(repoId, prNumber),
    pullsService.getCommits(repoId, prNumber),
    pullsService.getStatuses(repoId, prNumber),
    pullsService.getReviews(repoId, prNumber),
    pullsService.getDiscussions(repoId, prNumber),
  ]);

  return {
    pr,
    mergeChecks: settled(results[0], 'mergeChecks'),
    diff: settled(results[1], 'diff'),
    commits: settled(results[2], 'commits'),
    statuses: settled(results[3], 'statuses'),
    reviews: settled(results[4], 'reviews'),
    discussions: settled(results[5], 'discussions'),
  };
}
```

**Note:** Verify the exact function names and signatures in `src/modules/pulls/pulls.service.ts`. The diff endpoint may return large data -- if so, return only diff metadata (file list + stats) and let the full diff load lazily. Adjust accordingly.

- [ ] **Step 4: Write the controller**

```ts
// src/modules/pulls/pulls-hydrate.controller.ts
import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';
import * as hydrateService from './pulls-hydrate.service';

/**
 * GET /repos/:repoId/pulls/:prNumber/hydrate
 */
export async function hydratePRDetail(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await hydrateService.hydratePRDetail(
      param(req, 'repoId'),
      parseInt(param(req, 'prNumber'), 10),
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 5: Register the route in `pulls.routes.ts`**

```ts
import * as hydrateController from './pulls-hydrate.controller';

router.get('/:repoId/pulls/:prNumber/hydrate', authenticate, hydrateController.hydratePRDetail);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -- --run src/modules/pulls/pulls-hydrate.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/pulls/pulls-hydrate.service.ts src/modules/pulls/pulls-hydrate.controller.ts src/modules/pulls/pulls-hydrate.test.ts src/modules/pulls/pulls.routes.ts
git commit -m "feat: add PR Detail hydration endpoint (GET /pulls/:num/hydrate)"
```

---

## Task 5: PR Detail Hydration -- Frontend

**Files:**
- Modify: `frontend/src/api/hydrate.api.ts`
- Modify: `frontend/src/pages/repos/PRDetail.tsx`

- [ ] **Step 1: Add PR hydration types and API function to `hydrate.api.ts`**

```ts
export interface PRDetailHydration {
  pr: Record<string, unknown>;
  mergeChecks: Record<string, unknown> | null;
  diff: Record<string, unknown> | null;
  commits: unknown[] | null;
  statuses: unknown[] | null;
  reviews: unknown[] | null;
  discussions: unknown[] | null;
}

// Add to hydrateApi object:
prDetail: (repoId: string, prNumber: number) =>
  get<PRDetailHydration>(`/repos/${repoId}/pulls/${prNumber}/hydrate`),
```

- [ ] **Step 2: Integrate hydration into PRDetail.tsx**

Same pattern as Task 3: add hydration query, seed cache, add fallback guards to existing useQuery hooks. Remember to wrap the hydration mappings array in `useMemo` (as shown in Task 3) to avoid re-seeding on every render.

- [ ] **Step 3: Verify in browser**

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/hydrate.api.ts frontend/src/pages/repos/PRDetail.tsx
git commit -m "feat: integrate PR Detail hydration on frontend"
```

---

## Task 6: Issues List Hydration -- Backend

**Files:**
- Modify: `src/modules/issues/issues-hydrate.service.ts`
- Modify: `src/modules/issues/issues-hydrate.controller.ts`
- Modify: `src/modules/issues/issues-hydrate.test.ts`
- Modify: `src/modules/issues/issues.routes.ts`

- [ ] **Step 1: Add test for Issues List hydration**

Add to `issues-hydrate.test.ts`:
```ts
describe('Issues List Hydration', () => {
  it('should return issues list with filter context', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues/hydrate?status=OPEN`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('issues');
    expect(res.body).toHaveProperty('sprints');
    expect(res.body).toHaveProperty('customFields');
    expect(res.body).toHaveProperty('statuses');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run src/modules/issues/issues-hydrate.test.ts`

- [ ] **Step 3: Add `hydrateIssuesList` to the service**

```ts
// Add to src/modules/issues/issues-hydrate.service.ts

/**
 * Hydrate all data needed for the Issues List view.
 */
export async function hydrateIssuesList(
  projectId: string,
  filters: Record<string, string>,
) {
  const results = await Promise.allSettled([
    issuesService.listIssues(projectId, filters),
    sprintsService.list(projectId),
    customFieldsService.listByProject(projectId),
  ]);

  return {
    issues: settled(results[0], 'issues'),
    sprints: settled(results[1], 'sprints'),
    customFields: settled(results[2], 'customFields'),
  };
}
```

**Note:** Before implementing, check `IssueList.tsx` for additional queries (saved filters, workflows, statuses). For each:
1. Grep for the query key (e.g., `['saved-filters'`, `['workflows'`) in `IssueList.tsx`
2. Find the corresponding service function in the backend
3. Add it to the `Promise.allSettled` array and return object
4. Update the test assertions to match

The filter params should be passed through to `listIssues` exactly as the current Issues List page does.

- [ ] **Step 4: Add controller method**

```ts
// Add to src/modules/issues/issues-hydrate.controller.ts

/**
 * GET /projects/:projectId/issues/hydrate
 */
export async function hydrateIssuesList(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await hydrateService.hydrateIssuesList(
      param(req, 'projectId'),
      req.query as Record<string, string>,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 5: Register route**

**Important:** This route must be registered BEFORE `/:projectId/issues/:issueNumber` to avoid `hydrate` being parsed as an issue number.

```ts
router.get('/:projectId/issues/hydrate', authenticate, hydrateController.hydrateIssuesList);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -- --run src/modules/issues/issues-hydrate.test.ts`

- [ ] **Step 7: Commit**

```bash
git add src/modules/issues/issues-hydrate.service.ts src/modules/issues/issues-hydrate.controller.ts src/modules/issues/issues-hydrate.test.ts src/modules/issues/issues.routes.ts
git commit -m "feat: add Issues List hydration endpoint (GET /issues/hydrate)"
```

---

## Task 7: Issues List Hydration -- Frontend

**Files:**
- Modify: `frontend/src/api/hydrate.api.ts`
- Modify: `frontend/src/pages/issues/IssueList.tsx`

- [ ] **Step 1: Add API type and function**
- [ ] **Step 2: Integrate hydration into IssueList.tsx** (same cache-seeding pattern)
- [ ] **Step 3: Verify in browser**
- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/hydrate.api.ts frontend/src/pages/issues/IssueList.tsx
git commit -m "feat: integrate Issues List hydration on frontend"
```

---

## Task 8: Wiki Page Hydration -- Backend

**Files:**
- Create: `src/modules/wiki/wiki-hydrate.service.ts`
- Create: `src/modules/wiki/wiki-hydrate.controller.ts`
- Create: `src/modules/wiki/wiki-hydrate.test.ts`
- Modify: `src/modules/wiki/wiki.routes.ts`

- [ ] **Step 1: Write test**

Test `GET /api/wiki/spaces/:spaceId/pages/:pageSlug/hydrate` returns: `page`, `labels`, `attachments`, `history`, `children`.

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Write hydration service**

```ts
// src/modules/wiki/wiki-hydrate.service.ts
import { settled } from '../../utils/settled';
import * as wikiService from './wiki.service';

/**
 * Hydrate all data needed for the Wiki Page view.
 */
export async function hydrateWikiPage(spaceId: string, pageSlug: string) {
  // Primary lookup
  const page = await wikiService.getPage(spaceId, pageSlug);

  // Note: getPage already includes children and latest version.
  // Check what additional data PageView.tsx fetches separately:
  // - labels (page labels/tags)
  // - attachments (file attachments on the page)
  // - history (version history beyond the latest)
  const results = await Promise.allSettled([
    wikiService.getPageLabels(spaceId, pageSlug),
    wikiService.getPageAttachments(page.id),
    wikiService.getPageHistory(spaceId, pageSlug, { limit: 20 }),
  ]);

  return {
    page,
    labels: settled(results[0], 'labels'),
    attachments: settled(results[1], 'attachments'),
    history: settled(results[2], 'history'),
    children: page.children ?? [],
  };
}
```

**Note:** Verify exact function names in `wiki.service.ts`. The `getPage` function already includes `children` -- avoid double-fetching.

- [ ] **Step 4: Write controller and register route**
- [ ] **Step 5: Run test to verify it passes**
- [ ] **Step 6: Commit**

```bash
git add src/modules/wiki/wiki-hydrate.service.ts src/modules/wiki/wiki-hydrate.controller.ts src/modules/wiki/wiki-hydrate.test.ts src/modules/wiki/wiki.routes.ts
git commit -m "feat: add Wiki Page hydration endpoint (GET /pages/:slug/hydrate)"
```

---

## Task 9: Wiki Page Hydration -- Frontend

**Files:**
- Modify: `frontend/src/api/hydrate.api.ts`
- Modify: `frontend/src/pages/wiki/PageView.tsx`

- [ ] **Step 1: Add API type and function**
- [ ] **Step 2: Integrate hydration into PageView.tsx**
- [ ] **Step 3: Verify in browser**
- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/hydrate.api.ts frontend/src/pages/wiki/PageView.tsx
git commit -m "feat: integrate Wiki Page hydration on frontend"
```

---

## Task 10: Backlog Hydration -- Backend

**Files:**
- Create: `src/modules/issues/backlog-hydrate.service.ts`
- Create: `src/modules/issues/backlog-hydrate.controller.ts`
- Create: `src/modules/issues/backlog-hydrate.test.ts`
- Modify: `src/modules/issues/issues.routes.ts`

- [ ] **Step 1: Write test**

Test `GET /api/projects/:projectId/backlog/hydrate` returns: `sprints`, `backlog`, `velocity`, `customFields`.

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Write hydration service**

```ts
// src/modules/issues/backlog-hydrate.service.ts
import { settled } from '../../utils/settled';
import * as sprintsService from '../sprints/sprints.service';
import * as customFieldsService from '../custom-fields/custom-fields.service';
import * as issuesService from './issues.service';

/**
 * Hydrate all data needed for the Backlog view.
 */
export async function hydrateBacklog(projectId: string) {
  const results = await Promise.allSettled([
    sprintsService.list(projectId),
    issuesService.getBacklog(projectId),
    sprintsService.getVelocity(projectId),
    customFieldsService.listByProject(projectId),
  ]);

  return {
    sprints: settled(results[0], 'sprints'),
    backlog: settled(results[1], 'backlog'),
    velocity: settled(results[2], 'velocity'),
    customFields: settled(results[3], 'customFields'),
  };
}
```

**Note:** Verify function names -- `getBacklog` may be named differently (check `issues.service.ts` or `issue-board.service.ts`). Similarly `getVelocity` may be in sprints service.

- [ ] **Step 4: Write controller and register route**

**Note:** Check where backlog routes are currently mounted. Grep for `backlog` in `src/index.ts` and `issues.routes.ts` to find the existing mount point. The hydrate route must be registered on the same router. If backlog is served from `issues.routes.ts`, add the route there. If there's a separate backlog router, add it there instead. Update the **Files** list at the top of this task accordingly.

Route: `router.get('/:projectId/backlog/hydrate', authenticate, ...)`

**Important:** Register BEFORE any routes that might match `backlog` as a parameter.

- [ ] **Step 5: Run test to verify it passes**
- [ ] **Step 6: Commit**

```bash
git add src/modules/issues/backlog-hydrate.service.ts src/modules/issues/backlog-hydrate.controller.ts src/modules/issues/backlog-hydrate.test.ts src/modules/issues/issues.routes.ts
git commit -m "feat: add Backlog hydration endpoint (GET /backlog/hydrate)"
```

---

## Task 11: Backlog Hydration -- Frontend

**Files:**
- Modify: `frontend/src/api/hydrate.api.ts`
- Modify: `frontend/src/pages/issues/Backlog.tsx`

- [ ] **Step 1: Add API type and function**
- [ ] **Step 2: Integrate hydration into Backlog.tsx**
- [ ] **Step 3: Verify in browser**
- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/hydrate.api.ts frontend/src/pages/issues/Backlog.tsx
git commit -m "feat: integrate Backlog hydration on frontend"
```

---

## Task 12: Final Verification

- [ ] **Step 1: Run full backend test suite**

Run: `npm run test`
Expected: All tests pass, including new hydration tests

- [ ] **Step 2: Run frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run backend typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Manual smoke test all 5 views**

For each hydrated view, check:
1. Network tab shows single `/hydrate` call (plus context calls)
2. Page renders correctly with all data
3. Mutations (create, update, delete) still work and refresh data
4. Page works if `/hydrate` endpoint is blocked (fallback to granular)

- [ ] **Step 5: Commit any final fixes**

```bash
git commit -m "fix: address issues found during hydration smoke testing"
```
