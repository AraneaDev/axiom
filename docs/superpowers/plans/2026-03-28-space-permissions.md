# Space Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add granular per-space access control (view/edit/admin) to wiki spaces so teams can restrict sensitive content.

**Architecture:** New `SpacePermission` Prisma model, permission-checking middleware on all wiki routes, and a permissions management UI in space settings.

**Tech Stack:** Prisma, Express middleware, React, TanStack Query

**Spec:** `docs/superpowers/specs/2026-03-28-high-value-features-design.md` (Feature 3)

---

## File Structure

### Backend (new files)
- `src/modules/wiki/space-permissions.service.ts` — Permission CRUD and checking logic
- `src/modules/wiki/space-permissions.controller.ts` — API endpoints
- `src/modules/wiki/space-permissions.test.ts` — Tests
- `src/modules/wiki/space-permissions.middleware.ts` — Route-level permission enforcement

### Backend (modified files)
- `prisma/schema.prisma` — Add `SpacePermission` model
- `src/modules/wiki/wiki.routes.ts` — Mount permission endpoints and apply middleware

### Frontend (new files)
- `frontend/src/pages/wiki/SpacePermissions.tsx` — Permissions management UI
- `frontend/src/api/space-permissions.api.ts` — API client

### Frontend (modified files)
- `frontend/src/pages/wiki/PageViewSidebar.tsx` — Add lock icon for restricted spaces

---

## Task 1: Database Model

**Files:**
- Modify: `prisma/schema.prisma`

### Step 1: Add SpacePermission model

- [ ] Add to `prisma/schema.prisma`:

```prisma
enum SpacePermissionLevel {
  VIEW
  EDIT
  ADMIN
}

model SpacePermission {
  id         String               @id @default(cuid())
  spaceId    String
  space      WikiSpace            @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  userId     String?
  user       User?                @relation("SpacePermissions", fields: [userId], references: [id], onDelete: Cascade)
  teamRole   String?              // "ADMIN", "MEMBER", "VIEWER" — applies to all users with this team role
  level      SpacePermissionLevel
  createdAt  DateTime             @default(now())

  @@unique([spaceId, userId])
  @@unique([spaceId, teamRole])
  @@index([spaceId])
  @@map("space_permissions")
}
```

- [ ] Add the reverse relation to `WikiSpace`:

```prisma
// In WikiSpace model, add:
permissions SpacePermission[]
```

- [ ] Add the reverse relation to `User`:

```prisma
// In User model, add:
spacePermissions SpacePermission[] @relation("SpacePermissions")
```

### Step 2: Run migration

- [ ] Generate and apply the migration:

```bash
npx prisma migrate dev --name add-space-permissions
```

Expected: Migration created and applied successfully.

- [ ] Commit:

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(wiki): add SpacePermission model for per-space access control"
```

---

## Task 2: Permission Service

**Files:**
- Create: `src/modules/wiki/space-permissions.service.ts`
- Create: `src/modules/wiki/space-permissions.test.ts`

### Step 1: Write failing tests

- [ ] Create tests covering the core permission checking logic:

```typescript
// src/modules/wiki/space-permissions.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { canAccessSpace, getSpacePermissions, setSpacePermission, removeSpacePermission } from './space-permissions.service';

// These tests hit real PostgreSQL (axiom_test DB) per project conventions
// Setup: create a test org, team, user, and space before tests

describe('space-permissions', () => {
  // Test setup creates: testSpace, testUser (team MEMBER), adminUser (team ADMIN)

  describe('canAccessSpace (no custom permissions set)', () => {
    it('allows team members to view by default', async () => {
      const result = await canAccessSpace(testSpaceId, testUserId, 'VIEW');
      expect(result).toBe(true);
    });

    it('allows team members to edit by default', async () => {
      const result = await canAccessSpace(testSpaceId, testUserId, 'EDIT');
      expect(result).toBe(true);
    });
  });

  describe('canAccessSpace (with custom permissions)', () => {
    it('denies view when user has no permission and space has custom permissions', async () => {
      await setSpacePermission(testSpaceId, { userId: adminUserId, level: 'ADMIN' });
      const result = await canAccessSpace(testSpaceId, testUserId, 'VIEW');
      expect(result).toBe(false);
    });

    it('allows view when user has VIEW permission', async () => {
      await setSpacePermission(testSpaceId, { userId: testUserId, level: 'VIEW' });
      const result = await canAccessSpace(testSpaceId, testUserId, 'VIEW');
      expect(result).toBe(true);
    });

    it('denies edit when user only has VIEW permission', async () => {
      const result = await canAccessSpace(testSpaceId, testUserId, 'EDIT');
      expect(result).toBe(false);
    });

    it('allows edit when user has EDIT permission', async () => {
      await setSpacePermission(testSpaceId, { userId: testUserId, level: 'EDIT' });
      const result = await canAccessSpace(testSpaceId, testUserId, 'EDIT');
      expect(result).toBe(true);
    });

    it('allows via team role permission', async () => {
      await setSpacePermission(testSpaceId, { teamRole: 'MEMBER', level: 'VIEW' });
      const result = await canAccessSpace(testSpaceId, testUserId, 'VIEW');
      expect(result).toBe(true);
    });
  });
});
```

- [ ] Run tests to verify they fail:

```bash
npx vitest run src/modules/wiki/space-permissions.test.ts
```

### Step 2: Implement the service

- [ ] Create the service:

```typescript
// src/modules/wiki/space-permissions.service.ts
import { prisma } from '../../config/database';
import { SpacePermissionLevel } from '@prisma/client';

const LEVEL_HIERARCHY: Record<SpacePermissionLevel, number> = {
  VIEW: 1,
  EDIT: 2,
  ADMIN: 3
};

export async function canAccessSpace(
  spaceId: string,
  userId: string,
  requiredLevel: SpacePermissionLevel
): Promise<boolean> {
  // Check if space has any custom permissions
  const permissionCount = await prisma.spacePermission.count({
    where: { spaceId }
  });

  // No custom permissions = default team access (view + edit for all members)
  if (permissionCount === 0) {
    return true;
  }

  // Get user's team role for this space
  const space = await prisma.wikiSpace.findUnique({
    where: { id: spaceId },
    select: { teamId: true }
  });
  if (!space) return false;

  const membership = await prisma.teamMember.findUnique({
    where: {
      teamId_userId: { teamId: space.teamId, userId }
    }
  });
  if (!membership) return false;

  // Check direct user permission
  const userPermission = await prisma.spacePermission.findUnique({
    where: { spaceId_userId: { spaceId, userId } }
  });

  // Check team role permission
  const rolePermission = await prisma.spacePermission.findUnique({
    where: { spaceId_teamRole: { spaceId, teamRole: membership.role } }
  });

  // Take the highest granted level
  const grants = [userPermission, rolePermission].filter(Boolean);
  if (grants.length === 0) return false;

  const maxLevel = Math.max(...grants.map(g => LEVEL_HIERARCHY[g!.level]));
  return maxLevel >= LEVEL_HIERARCHY[requiredLevel];
}

export async function getSpacePermissions(spaceId: string) {
  return prisma.spacePermission.findMany({
    where: { spaceId },
    include: {
      user: { select: { id: true, username: true, displayName: true, avatarUrl: true } }
    },
    orderBy: { createdAt: 'asc' }
  });
}

export async function setSpacePermission(
  spaceId: string,
  data: { userId?: string; teamRole?: string; level: SpacePermissionLevel }
) {
  if (data.userId) {
    return prisma.spacePermission.upsert({
      where: { spaceId_userId: { spaceId, userId: data.userId } },
      create: { spaceId, userId: data.userId, level: data.level },
      update: { level: data.level }
    });
  } else if (data.teamRole) {
    return prisma.spacePermission.upsert({
      where: { spaceId_teamRole: { spaceId, teamRole: data.teamRole } },
      create: { spaceId, teamRole: data.teamRole, level: data.level },
      update: { level: data.level }
    });
  }
  throw new Error('Either userId or teamRole must be provided');
}

export async function removeSpacePermission(spaceId: string, permissionId: string) {
  return prisma.spacePermission.delete({
    where: { id: permissionId, spaceId }
  });
}
```

- [ ] Run tests to verify they pass:

```bash
npx vitest run src/modules/wiki/space-permissions.test.ts
```

- [ ] Commit:

```bash
git add src/modules/wiki/space-permissions.service.ts src/modules/wiki/space-permissions.test.ts
git commit -m "feat(wiki): add space permission service with level hierarchy and team role support"
```

---

## Task 3: Permission Middleware and Routes

**Files:**
- Create: `src/modules/wiki/space-permissions.controller.ts`
- Create: `src/modules/wiki/space-permissions.middleware.ts`
- Modify: `src/modules/wiki/wiki.routes.ts`

### Step 1: Create the middleware

- [ ] Create the middleware:

```typescript
// src/modules/wiki/space-permissions.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { canAccessSpace } from './space-permissions.service';
import { SpacePermissionLevel } from '@prisma/client';

export function requireSpaceAccess(level: SpacePermissionLevel) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const spaceId = req.params.spaceId;
    const userId = req.user!.id;

    const allowed = await canAccessSpace(spaceId, userId, level);
    if (!allowed) {
      return res.status(403).json({ error: { message: 'You do not have access to this space' } });
    }
    next();
  };
}
```

### Step 2: Create the controller

- [ ] Create the controller:

```typescript
// src/modules/wiki/space-permissions.controller.ts
import { Request, Response } from 'express';
import { getSpacePermissions, setSpacePermission, removeSpacePermission } from './space-permissions.service';

export async function listPermissions(req: Request, res: Response) {
  const permissions = await getSpacePermissions(req.params.spaceId);
  res.json(permissions);
}

export async function upsertPermission(req: Request, res: Response) {
  const { userId, teamRole, level } = req.body;
  const permission = await setSpacePermission(req.params.spaceId, { userId, teamRole, level });
  res.json(permission);
}

export async function deletePermission(req: Request, res: Response) {
  await removeSpacePermission(req.params.spaceId, req.params.permissionId);
  res.status(204).end();
}
```

### Step 3: Mount routes and apply middleware

- [ ] Modify `src/modules/wiki/wiki.routes.ts` to:
  1. Add permission management endpoints under `/spaces/:spaceId/permissions`
  2. Apply `requireSpaceAccess('VIEW')` to read routes (getSpace, getPage, pageTree, etc.)
  3. Apply `requireSpaceAccess('EDIT')` to write routes (createPage, updatePage, deletePage)
  4. Apply `requireSpaceAccess('ADMIN')` to permission management routes

```typescript
import { requireSpaceAccess } from './space-permissions.middleware';
import { listPermissions, upsertPermission, deletePermission } from './space-permissions.controller';

// Permission management routes (ADMIN only)
router.get('/spaces/:spaceId/permissions', requireSpaceAccess('ADMIN'), listPermissions);
router.put('/spaces/:spaceId/permissions', requireSpaceAccess('ADMIN'), upsertPermission);
router.delete('/spaces/:spaceId/permissions/:permissionId', requireSpaceAccess('ADMIN'), deletePermission);

// Apply to existing routes:
// GET /spaces/:spaceId → add requireSpaceAccess('VIEW')
// GET /spaces/:spaceId/tree → add requireSpaceAccess('VIEW')
// GET /spaces/:spaceId/pages/:pageSlug → add requireSpaceAccess('VIEW')
// POST /spaces/:spaceId/pages → add requireSpaceAccess('EDIT')
// PATCH /spaces/:spaceId/pages/:pageSlug → add requireSpaceAccess('EDIT')
// DELETE /spaces/:spaceId/pages/:pageSlug → add requireSpaceAccess('EDIT')
```

- [ ] Commit:

```bash
git add src/modules/wiki/space-permissions.controller.ts src/modules/wiki/space-permissions.middleware.ts src/modules/wiki/wiki.routes.ts
git commit -m "feat(wiki): add space permission middleware and management endpoints"
```

---

## Task 4: Frontend — Space Permissions UI

**Files:**
- Create: `frontend/src/api/space-permissions.api.ts`
- Create: `frontend/src/pages/wiki/SpacePermissions.tsx`
- Modify: `frontend/src/pages/wiki/PageViewSidebar.tsx`

### Step 1: Create the API client

- [ ] Create the API client:

```typescript
// frontend/src/api/space-permissions.api.ts
import { get, put, del } from './client';

export interface SpacePermission {
  id: string;
  spaceId: string;
  userId: string | null;
  teamRole: string | null;
  level: 'VIEW' | 'EDIT' | 'ADMIN';
  user: { id: string; username: string; displayName: string; avatarUrl: string | null } | null;
  createdAt: string;
}

export const spacePermissionsApi = {
  list: (spaceId: string) => get<SpacePermission[]>(`/spaces/${spaceId}/permissions`),
  upsert: (spaceId: string, data: { userId?: string; teamRole?: string; level: string }) =>
    put<SpacePermission>(`/spaces/${spaceId}/permissions`, data),
  remove: (spaceId: string, permissionId: string) =>
    del(`/spaces/${spaceId}/permissions/${permissionId}`),
};
```

### Step 2: Build the permissions management component

- [ ] Create `frontend/src/pages/wiki/SpacePermissions.tsx`:

Key elements:
- Table showing current permissions: user avatar + name OR team role badge, permission level dropdown
- "Add permission" row: user search select OR team role select, level select, add button (Plus icon)
- Delete button per row (Trash2 icon)
- Empty state: "No custom permissions. All team members have full access."
- Use `useQuery` with key `['space-permissions', spaceId]`
- Use `useMutation` for add/update/delete with query invalidation
- Wire into space settings (accessible from space header or sidebar)

### Step 3: Add lock icon to sidebar

- [ ] Modify `frontend/src/pages/wiki/PageViewSidebar.tsx`:

Add a query to check if the space has custom permissions. If it does, show a `Lock` icon (from `lucide-react`) next to the space name in the sidebar header.

```typescript
import { Lock } from 'lucide-react';
// Query permissions count or use a lightweight endpoint
// Show: <Lock className="h-4 w-4 text-muted-foreground" /> next to space name
```

- [ ] Commit:

```bash
git add frontend/src/api/space-permissions.api.ts frontend/src/pages/wiki/SpacePermissions.tsx frontend/src/pages/wiki/PageViewSidebar.tsx
git commit -m "feat(wiki): add space permissions management UI with lock indicator"
```

---

## Task 5: Documentation

**Files:**
- Modify: `docs/api-reference.md`

### Step 1: Update API reference

- [ ] Add to `docs/api-reference.md` under the Wiki section:

```markdown
### Space Permissions
- `GET /api/spaces/:spaceId/permissions` — List all permissions for a space (requires ADMIN)
- `PUT /api/spaces/:spaceId/permissions` — Add or update a permission `{ userId?, teamRole?, level }` (requires ADMIN)
- `DELETE /api/spaces/:spaceId/permissions/:permissionId` — Remove a permission (requires ADMIN)

**Permission levels:** VIEW < EDIT < ADMIN (each implies the levels below it)
**Default behavior:** No custom permissions = all team members have VIEW + EDIT access
**When custom permissions exist:** Only users/roles with explicit grants can access the space
```

- [ ] Commit:

```bash
git add docs/api-reference.md
git commit -m "docs: add space permissions API documentation"
```
