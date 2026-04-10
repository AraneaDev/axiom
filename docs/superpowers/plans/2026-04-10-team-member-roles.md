# Team Member Role Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show contextual role information on team members page — distinguish between direct team admins, org owners, and site superadmins.

**Architecture:** Enrich the backend team members response with `orgRole` (from OrgMembership) and `user.isAdmin` (site superadmin flag). Frontend shows contextual badges and disables role editing for users whose admin access is inherited from org/site level.

**Tech Stack:** Prisma 7, Express 5, React 19, TanStack Query, Tailwind CSS 4

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/modules/teams/teams.service.ts` | Modify | Add orgRole to member includes |
| `src/modules/teams/teams.service.test.ts` | Modify | Test enriched member response |
| `frontend/src/lib/types.ts` | Modify | Add orgRole + isAdmin to TeamMember |
| `frontend/src/pages/teams/TeamMembers.tsx` | Modify | Show contextual badges, disable inherited role editing |

---

### Task 1: Enrich Backend — Add orgRole and isAdmin to Team Members

**Files:**
- Modify: `src/modules/teams/teams.service.ts:50-63` (getTeam), `src/modules/teams/teams.service.ts:127-135` (listTeamMembers)

The key insight: `TeamMembership` links to `User`, and `User` has `orgMemberships`. We can include the org membership for the team's org to get the user's org-level role. We also need `user.isAdmin` for site superadmin detection.

- [ ] **Step 1: Read the current USER_BASIC_SELECT**

Read `src/utils/prisma-selects.ts` to see exactly what fields are in `USER_BASIC_SELECT`.

- [ ] **Step 2: Update the member include in `getTeam()`**

In `src/modules/teams/teams.service.ts`, find the `getTeam()` method (around line 50). The current member include is:

```typescript
members: { include: { user: { select: USER_BASIC_SELECT } } }
```

Change it to include the user's org membership for THIS team's org, plus `isAdmin`:

```typescript
members: {
  include: {
    user: {
      select: {
        ...USER_BASIC_SELECT,
        isAdmin: true,
        orgMemberships: {
          where: { orgId: team_orgId },
          select: { role: true },
        },
      },
    },
  },
  orderBy: { createdAt: 'asc' },
}
```

**Problem:** We don't know `orgId` until we query the team. Two approaches:
- Option A: Two queries — fetch team first, then members with orgId filter
- Option B: Include all orgMemberships and filter in code (wasteful)
- Option C: Use a raw query or Prisma's `relationLoadStrategy`

**Best approach:** Restructure `getTeam()` to first fetch the team (getting orgId), then fetch members with the orgId filter. Or simpler: include orgMemberships without a where clause (a user typically has 1-3 org memberships, so this is fine), and let the frontend match by checking the team's orgId.

**Simplest approach:** Just include `isAdmin` and all `orgMemberships` with `select: { orgId: true, role: true }`. The frontend already knows which org this team belongs to and can filter.

Update `getTeam()`:

```typescript
async getTeam(teamId: string) {
  return this.prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    include: {
      members: {
        include: {
          user: {
            select: {
              ...USER_BASIC_SELECT,
              isAdmin: true,
              orgMemberships: {
                select: { orgId: true, role: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      org: { select: { id: true, slug: true, name: true } },
      repos: true,
      projects: { select: { id: true, name: true, slug: true, prefix: true } },
      wikiSpaces: { select: { id: true, name: true, slug: true } },
    },
  });
}
```

**Note:** Check if `org` is already included — if so, just make sure `id` is selected. The `orgMemberships` include is lightweight (just orgId + role per membership).

- [ ] **Step 3: Update the member include in `listTeamMembers()`**

Same change for `listTeamMembers()` (around line 127):

```typescript
async listTeamMembers(teamId: string) {
  return this.prisma.teamMembership.findMany({
    where: { teamId },
    include: {
      user: {
        select: {
          ...USER_BASIC_SELECT,
          isAdmin: true,
          orgMemberships: {
            select: { orgId: true, role: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}
```

- [ ] **Step 4: Update `addTeamMember()` return include**

The `addTeamMember()` method (around line 147) also returns a member with user include. Update its return to match:

```typescript
include: {
  user: {
    select: {
      ...USER_BASIC_SELECT,
      isAdmin: true,
      orgMemberships: {
        select: { orgId: true, role: true },
      },
    },
  },
},
```

- [ ] **Step 5: Verify compilation**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/teams/teams.service.ts
git commit -m "feat(teams): include orgRole and isAdmin in team member responses"
```

---

### Task 2: Update Frontend Types

**Files:**
- Modify: `frontend/src/lib/types.ts:35-40`

- [ ] **Step 1: Update TeamMember type**

In `frontend/src/lib/types.ts`, find the `TeamMember` interface (around line 35). Current:

```typescript
export interface TeamMember {
  id: string;
  userId: string;
  role: 'ADMIN' | 'MEMBER' | 'VIEWER';
  user: { id: string; username: string; displayName: string };
}
```

Change to:

```typescript
export interface TeamMember {
  id: string;
  userId: string;
  role: 'ADMIN' | 'MEMBER' | 'VIEWER';
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
    isAdmin?: boolean;
    orgMemberships?: { orgId: string; role: string }[];
  };
}
```

Fields are optional so existing code that doesn't use them won't break.

- [ ] **Step 2: Verify compilation**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/types.ts
git commit -m "feat(types): add isAdmin and orgMemberships to TeamMember type"
```

---

### Task 3: Update TeamMembers Page — Contextual Role Badges

**Files:**
- Modify: `frontend/src/pages/teams/TeamMembers.tsx`

This is the main UI change. We need to:
1. Determine each member's "effective context" — are they admin because of team role, org ownership, or site superadmin?
2. Show a descriptive badge instead of just "ADMIN"
3. Disable the role dropdown for users whose admin is inherited (you can't demote an org owner at team level)

- [ ] **Step 1: Read the current TeamMembers.tsx fully**

Read the file to get exact line numbers for edits.

- [ ] **Step 2: Add a helper function to determine role context**

Add this helper near the top of the file (after imports):

```typescript
function getMemberRoleContext(
  member: TeamMember,
  orgId: string,
): { label: string; variant: 'primary' | 'default' | 'warning' | 'danger'; inherited: boolean } {
  // Site superadmin
  if (member.user.isAdmin) {
    return { label: 'Super Admin', variant: 'danger', inherited: true };
  }

  // Org owner — check orgMemberships for this team's org
  const orgMembership = member.user.orgMemberships?.find((m) => m.orgId === orgId);
  if (orgMembership?.role === 'OWNER') {
    return { label: 'Org Owner', variant: 'warning', inherited: true };
  }

  // Direct team role
  const roleLabels: Record<string, { label: string; variant: 'primary' | 'default' | 'warning' }> = {
    ADMIN: { label: 'Admin', variant: 'primary' },
    MEMBER: { label: 'Member', variant: 'default' },
    VIEWER: { label: 'Viewer', variant: 'warning' },
  };
  return { ...(roleLabels[member.role] ?? roleLabels.MEMBER), inherited: false };
}
```

- [ ] **Step 3: Get the orgId from team data**

The component fetches team detail. The team has an `orgId` field. Extract it:

```typescript
const orgId = teamDetail?.orgId ?? '';
```

If `orgId` is not on the Team type, it may need to be added to the Team interface in types.ts, or use `teamDetail?.org?.id`. Check what the API returns.

- [ ] **Step 4: Replace the role badge rendering**

Find where the role badge is rendered (the `ROLE_VARIANTS` map and the `<Badge>` element). Replace the static badge with the contextual one:

```tsx
const roleContext = getMemberRoleContext(member, orgId);

<Badge variant={roleContext.variant}>{roleContext.label}</Badge>
```

- [ ] **Step 5: Disable role dropdown for inherited roles**

Find the role change `<select>` or dropdown. When `roleContext.inherited` is true, disable it and optionally add a title tooltip explaining why:

```tsx
{roleContext.inherited ? (
  <span className="text-xs text-text-tertiary" title={`Role inherited from ${roleContext.label.toLowerCase()} status`}>
    {roleContext.label}
  </span>
) : (
  <select value={member.role} onChange={...}>
    <option value="ADMIN">Admin</option>
    <option value="MEMBER">Member</option>
    <option value="VIEWER">Viewer</option>
  </select>
)}
```

- [ ] **Step 6: Disable remove button for inherited admin roles**

When `roleContext.inherited` is true, also disable or hide the remove member button — you shouldn't be able to remove an org owner or superadmin from a team at team level.

- [ ] **Step 7: Update sidebar summary to show role breakdown with context**

The sidebar shows "ADMIN: 2, MEMBER: 2". Update to count by effective label instead of raw role, so it shows "Super Admin: 1, Org Owner: 1, Member: 2" etc.

- [ ] **Step 8: Verify compilation**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/teams/TeamMembers.tsx
git commit -m "feat(teams): show contextual role badges for inherited admin roles"
```

---

### Task 4: Verify End-to-End

- [ ] **Step 1: Run backend typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Run frontend typecheck**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run backend tests**

Run: `npm run test`
Expected: All tests pass

- [ ] **Step 4: Run full check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 5: Manual verification**

Navigate to `http://localhost:7000/voorbeeld/team-noord/members` and verify:
- Tim Schipper shows "Super Admin" badge (not "Admin")
- Erik Bakker shows "Org Owner" badge (not "Admin")
- Sanne de Boer shows "Member" badge
- Mila Smit shows "Member" badge
- Role dropdown is disabled for Tim and Erik
- Remove button is disabled for Tim and Erik
- Role dropdown works for Sanne and Mila
- Sidebar summary shows correct breakdown

- [ ] **Step 6: Fix any issues found and commit**

```bash
git add -A
git commit -m "fix: resolve any issues from team member role verification"
```
