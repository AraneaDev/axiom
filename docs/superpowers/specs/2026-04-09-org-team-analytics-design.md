# Org & Team Analytics Design Spec

## Overview

Add org-level and team-level analytics dashboards to give managers (like Erik at Voorbeeld) cross-team oversight of workload, hours spent, lead times, and backlog health. Team-level analytics provide per-project and per-person drill-down.

No new database models or migrations needed. All data already exists -- we aggregate it via new backend endpoints.

## Backend API Endpoints

### `GET /api/orgs/:orgSlug/analytics?period=30d`

Org-level dashboard. Returns aggregated data across all teams/projects in the org.

**Query params:**
- `period`: `7d` | `30d` (default) | `90d` | `quarter`

**Response shape:**

```json
{
  "workload": [
    {
      "userId": "...",
      "displayName": "Sanne de Boer",
      "teamName": "Team Noord",
      "teamSlug": "team-noord",
      "open": 2,
      "inProgress": 1,
      "inReview": 1,
      "total": 4
    }
  ],
  "hours": {
    "totalMinutes": 12600,
    "byMember": [
      {
        "userId": "...",
        "displayName": "Sanne de Boer",
        "teamName": "Team Noord",
        "projectName": "Partnerportaal",
        "minutes": 480
      }
    ],
    "byTeam": [
      { "teamName": "Team Noord", "minutes": 5400 }
    ]
  },
  "leadTimes": [
    {
      "projectName": "Partnerportaal",
      "projectSlug": "partnerportaal",
      "teamSlug": "team-noord",
      "avgLeadTimeDays": 4.2,
      "avgCycleTimeDays": 2.1,
      "issuesCompleted": 8
    }
  ],
  "backlog": [
    {
      "projectName": "Partnerportaal",
      "projectSlug": "partnerportaal",
      "teamSlug": "team-noord",
      "backlogSize": 3,
      "maintenanceCount": 1,
      "bugCount": 0,
      "oldestItemDays": 14
    }
  ]
}
```

**RBAC:** Requires org membership. Superadmins bypass.

### `GET /api/teams/:orgSlug/:teamSlug/analytics?period=30d`

Team-level detail. Same metrics but with more granularity.

**Query params:**
- `period`: `7d` | `30d` (default) | `90d` | `quarter`

**Response shape:**

```json
{
  "workload": [
    {
      "userId": "...",
      "displayName": "Sanne de Boer",
      "projects": [
        {
          "projectName": "Partnerportaal",
          "projectSlug": "partnerportaal",
          "open": 1,
          "inProgress": 1,
          "inReview": 0,
          "total": 2
        }
      ],
      "totalOpen": 2,
      "totalInProgress": 1,
      "totalInReview": 1,
      "total": 4
    }
  ],
  "hours": {
    "totalMinutes": 5400,
    "byMember": [
      {
        "userId": "...",
        "displayName": "Sanne de Boer",
        "byProject": [
          { "projectName": "Partnerportaal", "projectSlug": "partnerportaal", "minutes": 360 }
        ],
        "totalMinutes": 480
      }
    ],
    "byProject": [
      { "projectName": "Partnerportaal", "projectSlug": "partnerportaal", "minutes": 2100 }
    ]
  },
  "leadTimes": [
    {
      "projectName": "Partnerportaal",
      "projectSlug": "partnerportaal",
      "avgLeadTimeDays": 4.2,
      "avgCycleTimeDays": 2.1,
      "issuesCompleted": 8,
      "byType": {
        "TASK": { "avgLeadTimeDays": 3.0, "count": 4 },
        "BUG": { "avgLeadTimeDays": 1.5, "count": 2 },
        "STORY": { "avgLeadTimeDays": 6.0, "count": 2 }
      }
    }
  ],
  "backlog": [
    {
      "projectName": "Partnerportaal",
      "projectSlug": "partnerportaal",
      "backlogSize": 3,
      "maintenanceCount": 1,
      "bugCount": 0,
      "oldestItemDays": 14,
      "issues": [
        {
          "id": "...",
          "number": 5,
          "title": "Verouderde Node.js dependencies updaten",
          "type": "TASK",
          "priority": "LOW",
          "ageDays": 14,
          "labels": ["onderhoud"]
        }
      ]
    }
  ]
}
```

**RBAC:** Requires team membership. Superadmins bypass.

## Backend Module Structure

New module: `src/modules/analytics/`

| File | Responsibility |
|------|---------------|
| `analytics.routes.ts` | Route definitions, mounted under `/api/orgs` and `/api/teams` |
| `analytics.controller.ts` | Parse period param, call service, return JSON |
| `analytics.service.ts` | SQL aggregation queries via Prisma |

### Aggregation Logic

- **Workload:** `prisma.issue.groupBy` on `assigneeId` + `columnId`, joined with board column names. Categorize columns: default column = "open", done column = excluded, others mapped by name ("In Ontwikkeling"/"In Progress" = inProgress, "Code Review"/"Review" = inReview, rest = open).
- **Hours:** `prisma.timeEntry.groupBy` on `userId`, filtered by `loggedAt` within period. Join with issue's project for project breakdown.
- **Lead times:** For issues in done columns within the period, calculate `updatedAt - createdAt` as lead time. Cycle time = time from first non-default column to done column (use `updatedAt` as proxy). Group by project.
- **Backlog:** `prisma.issue.count` where column `isDefault = true` (backlog column), grouped by project. Join labels for maintenance/bug breakdown. Calculate age from `createdAt`.

### Period Param Resolution

| Value | Date Range |
|-------|-----------|
| `7d` | Now - 7 days |
| `30d` | Now - 30 days |
| `90d` | Now - 90 days |
| `quarter` | Start of current quarter to now |

### RBAC

- Org analytics: reuse `requireOrgMembership` middleware. Superadmins bypass via `isAdmin` check.
- Team analytics: reuse `requireTeamPermission` middleware. Superadmins bypass via `isAdmin` check.

## Frontend Pages & Routing

### New Routes

| Route | Page | Purpose |
|-------|------|---------|
| `/:org/analytics` | `OrgAnalytics.tsx` | Org dashboard for manager oversight |
| `/:org/:team/analytics` | `TeamAnalytics.tsx` | Team detail with per-project/per-person breakdown |

### Shared Components

**`PeriodSelector`** -- Dropdown with presets:
- Last 7 days
- Last 30 days (default)
- Last 90 days
- This quarter

### Navigation Integration

- Org page (`/:org`): Add analytics button/link to navigate to `/:org/analytics`
- Team detail page (`/:org/:team`): Add analytics button/link to navigate to `/:org/:team/analytics`
- Org analytics: team rows link to `/:org/:teamSlug/analytics` for drill-down

### Org Analytics Page Layout (`OrgAnalytics.tsx`)

Four card sections:

**1. Workload Overview**
- Table: rows = team members, columns = Team, Open, In Progress, In Review, Total
- Sorted by total descending (busiest at top)
- Color-coded cells: green (low), amber (medium), red (high)
- Grouped by team with subtotals

**2. Hours Spent**
- Summary cards: Total hours, Average per person, by team
- Table: rows = members, columns = Team, Project, Hours
- Sortable by any column

**3. Lead Times**
- Table: rows = projects, columns = Avg Lead Time (days), Avg Cycle Time (days), Issues Completed
- Bar chart showing lead time per project for visual comparison

**4. Backlog Health**
- Table: rows = projects, columns = Backlog Size, Maintenance, Bugs, Oldest Item (days)
- Color-coded: red if backlog has old items (> 30 days) or high count

Each team/project row is clickable to drill into team analytics.

### Team Analytics Page Layout (`TeamAnalytics.tsx`)

Four card sections with per-project and per-person granularity:

**1. Workload by Member**
- Table: rows = members, columns = Project, Open, In Progress, In Review, Total
- Each member shows issues broken down by project
- Expandable rows to see individual issue titles

**2. Hours by Member & Project**
- Table: rows = members, columns = each project as column + Total
- Hours logged per member per project
- Summary row with project totals

**3. Lead Times by Project**
- Table: rows = projects, columns = Avg Lead Time, Avg Cycle Time, By Type (Task/Bug/Story)
- Lead time breakdown per issue type

**4. Backlog by Project**
- Per-project expandable sections showing actual backlog issues
- Each issue: title, priority, type, age (days), labels
- Sorted by priority then age

### Existing Page Enhancements

**Org page (`/:org` -- TeamList.tsx):**
- Add analytics navigation button
- Team cards show summary stats: open issues count, active sprint progress

**Team detail page (`/:org/:team` -- TeamDetail.tsx):**
- Add analytics navigation button
- Project cards show issue counts by column status

## UI Patterns

- Follow existing `ProjectAnalytics.tsx` patterns for card layout, data fetching, and loading states
- Use TanStack Query for data fetching with the period as query key
- Use existing shared UI components from `frontend/src/components/ui/`
- Tables use existing table patterns (if available) or simple HTML tables with Tailwind
- Bar chart: use a lightweight approach (CSS-based bars or a minimal chart lib if one is already in the project)
- Color coding via CSS variable tokens (not direct Tailwind palette colors)

## Excluded (YAGNI)

- No export to PDF/Excel
- No real-time updates (standard React Query refetch)
- No configurable dashboard widgets or drag-and-drop
- No custom date range picker (presets only)
- No comparison views (quarter vs quarter)
- No email/scheduled reports
- Tables first, additional charts can be added incrementally
