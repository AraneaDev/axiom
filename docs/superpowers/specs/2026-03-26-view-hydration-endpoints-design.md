# View Hydration Endpoints

## Problem

Individual views make 7-16+ API calls on initial load. Each sub-resource endpoint independently looks up the parent entity, resulting in redundant DB queries and a waterfall of XHR requests. For example, the Issue Detail page makes ~16 calls, each doing its own `findIssueOrThrow()`.

## Approach

Hybrid hydration: the top 5 heaviest views each get a single `/hydrate` endpoint that returns all data needed for first paint. Granular endpoints remain for mutations, cache invalidation after writes, and lazy-loaded secondary data. Lighter views (Board, Dashboard, Repo List, Roadmap, Milestones) stay as-is.

## Hydrated Views

### 1. Issue Detail (16 calls -> 1)

**Endpoint:** `GET /api/projects/:projectId/issues/:issueNumber/hydrate`

**Response:**
```json
{
  "issue": {},
  "votes": { "count": 0, "voted": false },
  "watchers": { "count": 0, "watching": false },
  "links": [],
  "children": [],
  "progress": { "done": 0, "total": 0, "percent": 0 } | null,
  "development": {
    "branches": [],
    "pullRequests": [],
    "commits": []
  },
  "activity": [],
  "attachments": [],
  "worklogs": [],
  "sprints": [],
  "customFields": []
}
```

### 2. PR Detail (9 calls -> 1)

**Endpoint:** `GET /api/repos/:repoId/pulls/:prNumber/hydrate`

**Response:**
```json
{
  "pr": {},
  "mergeChecks": {},
  "diff": {},
  "commits": [],
  "statuses": [],
  "reviews": [],
  "discussions": []
}
```

### 3. Issues List (8 calls -> 1)

**Endpoint:** `GET /api/projects/:projectId/issues/hydrate?status=...&...`

Passes through all existing filter/sort/pagination query params.

**Response:**
```json
{
  "issues": { "data": [], "total": 0, "page": 0 },
  "sprints": [],
  "savedFilters": [],
  "customFields": [],
  "workflows": [],
  "statuses": []
}
```

### 4. Wiki Page View (7 calls -> 1)

**Endpoint:** `GET /api/wiki/spaces/:spaceId/pages/:pageSlug/hydrate`

**Response:**
```json
{
  "page": {},
  "labels": [],
  "attachments": [],
  "history": [],
  "children": []
}
```

### 5. Backlog (6 calls -> 1)

**Endpoint:** `GET /api/projects/:projectId/backlog/hydrate`

**Response:**
```json
{
  "sprints": [],
  "backlog": [],
  "velocity": {},
  "customFields": []
}
```

## Not Hydrated

These views are already lean enough:

- Board (4 calls)
- Dashboard (4 calls)
- Repo Detail (5 calls -- mostly file content that varies by path)
- Repo List (2 calls)
- Roadmap (2 calls)
- Milestones (1 call)

Context requests (`me`, `unread-count`, `orgs`, team/project lookups) stay as-is -- shared across all views and cached by React Query from navigation.

## Backend Pattern

Each hydration service method:

1. Looks up the parent entity once (`findIssueOrThrow`, `findPROrThrow`, etc.) -- this also serves as the authorization check (existing `findOrThrow` functions enforce access)
2. Runs all sub-queries in `Promise.allSettled()` in parallel, passing the resolved entity ID
3. Returns `null` for any sub-query that fails (partial failure tolerance)
4. Logs partial failures at `warn` level server-side for debugging degraded responses

```ts
async function hydrateIssueDetail(projectId: string, issueNumber: number, userId: string) {
  const issue = await findIssueOrThrow(projectId, issueNumber);

  const [votes, watchers, links, children, progress, branches, pullRequests, commits, activity, attachments, worklogs, sprints, customFields] =
    await Promise.allSettled([
      getVotes(issue.id, userId),
      getWatchers(issue.id, userId),
      getLinks(issue.id),
      getChildren(issue.id),
      getProgress(issue.id),
      getBranches(issue.id),
      getPullRequests(issue.id),
      getCommits(issue.id),
      getActivity(issue.id, { limit: 50 }),
      getAttachments(issue.id),
      getWorklogs(issue.id),
      sprintsService.list(projectId),
      customFieldsService.listByProject(projectId),
    ]);

  return {
    issue,
    votes: settled(votes),
    watchers: settled(watchers),
    // ... etc
  };
}

function settled<T>(result: PromiseSettledResult<T>, label: string): T | null {
  if (result.status === 'fulfilled') return result.value;
  console.warn(`[hydrate] partial failure in ${label}:`, result.reason);
  return null;
}
```

Routes register on existing routers:
```ts
router.get('/:projectId/issues/:issueNumber/hydrate', authenticate, issuesController.hydrate);
```

## Response Shape Contract

Each nested field in a hydration response matches the exact response shape of its corresponding granular endpoint. No transformation or reshaping -- if `GET /issues/:num/votes` returns `{ count: number, voted: boolean }`, then `hydration.votes` is the same `{ count: number, voted: boolean }`. This keeps the cache-seeding mechanical and avoids mapping logic.

## Frontend Pattern

### Cache Seeding

The hydration response seeds React Query's cache for individual query keys. Child components keep their existing `useQuery` hooks unchanged -- they find warm cache instead of fetching.

```ts
const hydrationQuery = useQuery({
  queryKey: ['issue-hydrate', projectId, num],
  queryFn: () => issuesApi.hydrate(projectId, num),
  retry: 1,
  staleTime: 30_000, // hydration data is fresh for 30s
});

useEffect(() => {
  if (!hydrationQuery.data) return;
  const qc = queryClient;
  const data = hydrationQuery.data;
  const seed = <T>(key: QueryKey, val: T | null) => {
    if (val !== null) qc.setQueryData(key, val);
  };
  seed(['issue', projectId, num], data.issue);
  seed(['issue-votes', projectId, num], data.votes);
  seed(['issue-watchers', projectId, num], data.watchers);
  seed(['issue-links', projectId, num], data.links);
  // ... all sections
}, [hydrationQuery.data]);
```

### Fallback on Failure

Child queries are disabled while hydration is loading. They only fire if hydration fails or if their section came back `null` (partial failure):

```ts
const { data: votes } = useQuery({
  queryKey: ['issue-votes', projectId, num],
  queryFn: () => issuesApi.getVotes(projectId, num),
  enabled: hydrationQuery.isError
    || (hydrationQuery.isSuccess && hydrationQuery.data.votes === null),
  staleTime: 30_000,
});
```

This prevents a race where child queries fire before hydration lands. During normal operation, child queries find warm cache from the seeding effect. On hydration failure, the page behaves exactly like it does today.

### Mutation Behavior

Mutations continue to invalidate granular query keys as they do today. After a vote toggle, `['issue-votes']` refetches independently via its granular endpoint. The hydration query is only for initial load, never refetched automatically.

### Pagination

Hydration returns the first page of paginated data (e.g., activity with `limit: 50`). Subsequent pages are loaded by the existing granular endpoints as the user scrolls. The hydration endpoint does not support pagination params -- it always returns the initial view.

## Scoping Notes

- **PR Detail diff:** The hydration endpoint includes diff metadata (file list, stats) but not the full diff content. The full diff loads lazily via the existing granular endpoint since it can be very large.
- **Wiki history:** Hydration returns the last 20 revisions. Full history paginates via the granular endpoint.
- **Issues List statuses vs workflows:** `statuses` is the flat list of status objects for filter/display. `workflows` is the ordered workflow definition. Both are returned as-is from their existing service functions.

## Implementation Order

1. Issue Detail hydration (highest impact: 16 -> 1)
2. PR Detail hydration (9 -> 1)
3. Issues List hydration (8 -> 1)
4. Wiki Page hydration (7 -> 1)
5. Backlog hydration (6 -> 1)

Each view is independent and can be shipped/tested individually.
