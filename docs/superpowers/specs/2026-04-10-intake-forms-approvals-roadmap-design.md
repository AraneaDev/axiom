# Public Intake Forms, Approval Workflows & Visual Roadmap — Design Spec

**Date:** 2026-04-10
**Status:** Approved
**Features:** Public Intake Forms, Column-Gate Approval Workflows, Visual Roadmap (Timeline + Buckets)

---

## Table of Contents

1. [Public Intake Forms](#1-public-intake-forms)
2. [Column-Gate Approval Workflows](#2-column-gate-approval-workflows)
3. [Visual Roadmap](#3-visual-roadmap)
4. [Shared Infrastructure](#4-shared-infrastructure)
5. [New UI Components](#5-new-ui-components)

---

## 1. Public Intake Forms

### Overview

A form builder that lets project admins design multi-page forms with branching logic. Published forms are accessible via a public URL. Submissions land in a moderation queue where team members review, approve (creating an issue), or reject them.

### Data Models

```
Form
  id            String    @id @default(cuid())
  projectId     String    → Project
  name          String
  slug          String    @unique   // used in public URL: /f/:slug
  description   String?
  status        FormStatus          // DRAFT | PUBLISHED | ARCHIVED
  authMode      FormAuthMode        // PUBLIC | TOKEN_GATED
  sharedSecret  String?             // hashed, for TOKEN_GATED forms
  spamProtection FormSpamProtection  // NONE | CAPTCHA | RATE_LIMIT
  rateLimitPerHour Int?
  successMessage String?
  redirectUrl   String?
  createdById   String    → User
  createdAt     DateTime
  updatedAt     DateTime
  pages         FormPage[]
  submissions   FormSubmission[]

FormPage
  id              String  @id @default(cuid())
  formId          String  → Form
  title           String
  position        Int
  conditionFieldId String?  → FormField  // if null, always shown
  conditionOperator String?              // EQUALS | NOT_EQUALS | CONTAINS | GT | LT
  conditionValue  String?               // value to compare against
  fields          FormField[]

FormField
  id              String  @id @default(cuid())
  formPageId      String  → FormPage
  position        Int
  type            FormFieldType  // TEXT | TEXTAREA | SELECT | MULTISELECT | CHECKBOX | RADIO | DATE | FILE | HEADING | DESCRIPTION
  label           String
  placeholder     String?
  helpText        String?
  required        Boolean @default(false)
  options         Json?   // array of {label, value} for select/radio/multiselect
  issueFieldMapping String? // "title" | "body" | "type" | "priority" | "labels" | "customField:<id>"
  validationRules Json?   // {minLength?, maxLength?, pattern?}

FormSubmission
  id              String  @id @default(cuid())
  formId          String  → Form
  projectId       String  → Project
  status          SubmissionStatus  // PENDING | APPROVED | REJECTED | SPAM
  data            Json    // field values keyed by FormField id
  submitterEmail  String?
  submitterName   String?
  submitterIp     String
  issueId         String? → Issue  // set after approval
  reviewedById    String? → User
  reviewedAt      DateTime?
  reviewNote      String?
  createdAt       DateTime
```

**Enums:**

```
FormStatus: DRAFT | PUBLISHED | ARCHIVED
FormAuthMode: PUBLIC | TOKEN_GATED
FormSpamProtection: NONE | CAPTCHA | RATE_LIMIT
FormFieldType: TEXT | TEXTAREA | SELECT | MULTISELECT | CHECKBOX | RADIO | DATE | FILE | HEADING | DESCRIPTION
SubmissionStatus: PENDING | APPROVED | REJECTED | SPAM
```

### API Routes

**Public (no auth):**

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/f/:formSlug` | Get published form structure (pages + fields) |
| POST | `/f/:formSlug/submit` | Submit form data |
| POST | `/f/:formSlug/verify` | Verify captcha or shared secret |

**Authenticated (project members):**

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/projects/:projectId/forms` | List forms |
| POST | `/api/projects/:projectId/forms` | Create form |
| GET | `/api/projects/:projectId/forms/:formId` | Get form with pages/fields |
| PATCH | `/api/projects/:projectId/forms/:formId` | Update form metadata |
| DELETE | `/api/projects/:projectId/forms/:formId` | Delete form |
| PATCH | `/api/projects/:projectId/forms/:formId/publish` | Toggle DRAFT/PUBLISHED |
| POST | `/api/projects/:projectId/forms/:formId/pages` | Create page |
| PATCH | `/api/projects/:projectId/forms/:formId/pages/:pageId` | Update page |
| DELETE | `/api/projects/:projectId/forms/:formId/pages/:pageId` | Delete page |
| POST | `/api/projects/:projectId/forms/:formId/pages/reorder` | Bulk reorder pages |
| POST | `/api/projects/:projectId/forms/:formId/pages/:pageId/fields` | Create field |
| PATCH | `/api/projects/:projectId/forms/:formId/pages/:pageId/fields/:fieldId` | Update field |
| DELETE | `/api/projects/:projectId/forms/:formId/pages/:pageId/fields/:fieldId` | Delete field |
| POST | `/api/projects/:projectId/forms/:formId/fields/reorder` | Bulk reorder fields |
| GET | `/api/projects/:projectId/intake` | List submissions (filterable by status) |
| GET | `/api/projects/:projectId/intake/:submissionId` | View submission detail |
| POST | `/api/projects/:projectId/intake/:submissionId/approve` | Approve, creates issue |
| POST | `/api/projects/:projectId/intake/:submissionId/reject` | Reject with note |
| POST | `/api/projects/:projectId/intake/:submissionId/spam` | Mark as spam |

### Form Builder UI

Located in project settings. Features:

- **Page management:** Add, reorder (drag-and-drop), delete pages. Each page has a title and optional branching condition.
- **Field management:** Within each page, add/reorder/delete fields. Configure type, label, required, placeholder, help text, validation rules, and options (for select/radio/multiselect).
- **Issue field mapping:** Each field can optionally map to an issue field. `title` mapping is required on at least one field for the form to be publishable.
- **Branching conditions:** Per-page: "Show this page if [field] on a previous page [operator] [value]". The builder validates that condition fields reference fields on earlier pages.
- **Preview mode:** Simulates the public form experience with page navigation and condition evaluation.
- **Publish flow:** Form must have at least one page, one field mapped to `title`, and valid branching before publishing.

### Public Form Rendering

Standalone page at `/f/:formSlug` with minimal layout (no app navigation, project branding only).

1. If `TOKEN_GATED`: show secret input first, verify via `/verify` endpoint
2. If `CAPTCHA`: render captcha widget on the final page
3. Multi-step wizard: show current page fields, "Back" / "Next" / "Submit" buttons
4. Page navigation evaluates branching conditions client-side to determine next page
5. On submit: POST to `/submit`, show success message or redirect

### Spam Protection

- **Captcha:** Cloudflare Turnstile widget on the final page
- **Rate limiting:** Per-IP throttle using Redis, configurable `rateLimitPerHour` per form
- **Honeypot:** Hidden field injected automatically, submissions that fill it are auto-marked SPAM

### Intake Queue UI

Dedicated project page at `/:org/:team/:project/intake`.

- **Table view:** Columns: submitter name/email, form name, submitted date, status
- **Status filter tabs:** Pending | Approved | Rejected | Spam
- **Submission detail:** Expandable or slide-over panel showing all field values alongside their issue field mappings
- **Approve action:** Shows a preview of the issue that will be created with mapped fields pre-filled. Reviewer can edit any field before confirming. On confirm: issue is created, `FormSubmission.issueId` is set, status set to APPROVED.
- **Reject action:** Text input for rejection note, optional "notify submitter" checkbox (sends email if submitter email was collected)
- **Bulk actions:** Select multiple submissions for bulk approve/reject/spam

---

## 2. Column-Gate Approval Workflows

### Overview

Project admins can gate specific board column transitions behind approval requirements. When a user tries to move an issue across a gated transition, they nominate approvers. The issue stays in place with a visual indicator until the required approvals are collected.

### Data Models

```
ApprovalGate
  id              String  @id @default(cuid())
  projectId       String  → Project
  fromColumnId    String  → BoardColumn
  toColumnId      String  → BoardColumn
  minApprovals    Int     @default(1)
  allowSelfApproval Boolean @default(false)
  enabled         Boolean @default(true)
  createdAt       DateTime
  updatedAt       DateTime
  @@unique([projectId, fromColumnId, toColumnId])

ApprovalRequest
  id              String  @id @default(cuid())
  issueId         String  → Issue
  approvalGateId  String  → ApprovalGate
  targetColumnId  String  → BoardColumn  // where the issue should move on approval
  requestedById   String  → User
  status          ApprovalRequestStatus  // PENDING | APPROVED | REJECTED | CANCELLED
  createdAt       DateTime
  resolvedAt      DateTime?
  votes           ApprovalVote[]

ApprovalVote
  id                String  @id @default(cuid())
  approvalRequestId String  → ApprovalRequest
  userId            String  → User
  decision          ApprovalDecision  // APPROVED | REJECTED
  comment           String?
  createdAt         DateTime
```

**Enums:**

```
ApprovalRequestStatus: PENDING | APPROVED | REJECTED | CANCELLED
ApprovalDecision: APPROVED | REJECTED
```

### API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/projects/:projectId/approval-gates` | List gates |
| POST | `/api/projects/:projectId/approval-gates` | Create gate |
| PATCH | `/api/projects/:projectId/approval-gates/:gateId` | Update gate |
| DELETE | `/api/projects/:projectId/approval-gates/:gateId` | Delete gate |
| POST | `/api/issues/:issueId/approval-requests` | Create request (body: approverIds[]) |
| GET | `/api/issues/:issueId/approval-requests` | List requests for issue |
| GET | `/api/issues/:issueId/approval-requests/:requestId` | Get request with votes |
| POST | `/api/approval-requests/:requestId/vote` | Cast vote |
| POST | `/api/approval-requests/:requestId/cancel` | Cancel request |
| GET | `/api/users/me/pending-approvals` | List all pending approvals for current user |

### Board Integration Flow

1. User drags issue from column A to column B on the Kanban board
2. Frontend checks locally cached `ApprovalGate` list: does a gate exist for A → B?
3. **No gate:** normal move, issue transitions immediately
4. **Gate exists:** drag is intercepted, approval nomination modal opens:
   - Header: "This transition requires approval"
   - Shows: from column, to column, min approvals required
   - Approver picker: autocomplete from project members, must select >= `minApprovals`
   - If `allowSelfApproval` is false, current user is excluded from picker
   - Confirm button creates `ApprovalRequest`
5. Issue stays in column A with a visual "Pending Approval" badge:
   - Amber badge with `Clock` icon on the board card
   - Tooltip shows: "Awaiting approval to move to [column B]"
6. Issue drag is disabled while a PENDING request exists

### Approval Resolution

**Approver actions:**
- Approvers receive in-app notification + email (if configured)
- Vote from: issue detail "Approvals" tab, notification quick action, or "My Approvals" page
- Each vote: APPROVED or REJECTED with optional comment

**Auto-resolution logic (server-side):**
- On each new vote, count APPROVED votes for the request
- If approved count >= `minApprovals`: set request status to APPROVED, move issue to target column, log activity, notify requester
- If any vote is REJECTED: set request status to REJECTED, issue stays in place, badge turns red (`XCircle` icon), notify requester with rejection comment
- Requester can create a new request after addressing feedback

**My Approvals page:**
- Located at `/:org/approvals` (org-wide view)
- Table: issue key, title, project, requested by, requested date, action buttons
- Quick approve/reject inline without navigating to issue

### Gate Configuration UI

In project settings, new "Approvals" tab:
- Table of configured gates: "From → To", min approvals, self-approval toggle, enabled toggle
- Create/edit via modal: select from-column, to-column, min approvals, toggle self-approval
- Delete with confirmation (auto-cancels pending requests for that gate)
- Visual hint: board column headers show a lock icon if any inbound transition is gated

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Issue already has pending request | Cannot create second request; must cancel first |
| Approver removed from project | Their pending vote is voided; approval count rechecked |
| Gate deleted while requests pending | All pending requests auto-cancelled; issues unblocked |
| Gate disabled while requests pending | Pending requests remain active (disable prevents new requests only) |
| Column deleted | Cascade delete associated gates |
| Self-approval blocked | Requester excluded from approver picker; server validates |

---

## 3. Visual Roadmap

### Overview

A dual-mode project roadmap view: **Timeline** (Gantt-style) and **Buckets** (customizable columns like Now/Next/Later). Both modes show a hierarchical view with epics as primary rows, expandable to child issues. Timeline supports interactive dependency arrows. All chart rendering uses custom-built components — no third-party chart libraries.

### Data Models

```
RoadmapBucket
  id          String  @id @default(cuid())
  projectId   String  → Project
  name        String
  position    Int
  color       String?   // CSS variable token name (e.g., "var(--color-accent)")
  createdAt   DateTime
  updatedAt   DateTime

Issue (existing model, add fields):
  startDate        DateTime?  // explicit start date for roadmap timeline bars
  roadmapBucketId  String?    → RoadmapBucket
```

No additional models needed. Timeline reads from existing `dueDate`, `createdAt`, sprint dates, and `IssueLink` (BLOCKS/IS_BLOCKED_BY).

### API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/projects/:projectId/roadmap/buckets` | List buckets |
| POST | `/api/projects/:projectId/roadmap/buckets` | Create bucket |
| PATCH | `/api/projects/:projectId/roadmap/buckets/:id` | Update bucket |
| DELETE | `/api/projects/:projectId/roadmap/buckets/:id` | Delete bucket (unsets `roadmapBucketId` on issues) |
| POST | `/api/projects/:projectId/roadmap/buckets/reorder` | Bulk reorder |
| GET | `/api/projects/:projectId/roadmap/timeline` | Issues with dates + deps for timeline |
| GET | `/api/projects/:projectId/roadmap/buckets-view` | Issues grouped by bucket |

### Timeline View (Gantt)

**Layout:**
- Horizontal time axis with scrollable viewport
- Zoom levels: Weeks | Months | Quarters (toggle in toolbar)
- Header row shows time divisions with gridlines
- Rows are epics, expandable to show child issues indented below
- Standalone issues (no parent, not an epic) with dates also appear as rows
- Issues without dates do not appear on timeline

**Bar Rendering:**
- Each issue renders as a horizontal bar from start date to due date
- Start date: explicit `startDate` field on the issue (set via roadmap bar drag or issue detail)
- If only due date exists: render as a diamond marker (milestone style)
- Bar color: derived from issue type or priority (using CSS variable tokens)
- Bar content: issue key + truncated title
- Progress indicator: filled portion based on child issue completion % (for epics)

**Dependency Arrows:**
- Drawn from `IssueLink` records where type is `BLOCKS` or `IS_BLOCKED_BY`
- SVG path arrows connecting the end of blocker bar to the start of blocked bar
- Arrow routing: simple right-angle connectors avoiding bar overlap
- Violation highlighting: arrow turns `var(--color-danger)` if blocked issue starts before blocker ends
- **Interactive creation:** hover over bar edge reveals a drag handle (circle). Drag from one bar to another to create a `BLOCKS` IssueLink. Confirmation tooltip before creating.
- **Interactive deletion:** click an existing arrow to select it, press Delete or click "Remove" tooltip to delete the IssueLink.

**Bar Interactions:**
- Drag bar left/right edge to change start/due date (PATCH issue on drop)
- Drag entire bar to shift both dates by the same offset
- Click bar to open issue detail side panel
- Hover shows tooltip: issue key, title, dates, assignee, status

**Filters (shared across both views):**
- Assignee, label, issue type, milestone, sprint
- Text search on issue title/key

### Bucket View

**Layout:**
- Horizontal columns, one per `RoadmapBucket`
- An "Unassigned" pseudo-column on the right for issues that have been explicitly added to the roadmap (via "Add to roadmap") but not yet assigned to a bucket — this does NOT show all project issues
- Within each column: cards for epics, expandable to show children
- Column header: bucket name, issue count, optional color bar

**Card Content:**
- Issue key + title
- Type icon (from `IssueTypeIcon`)
- Priority badge (from `PriorityBadge`)
- Assignee avatar (from `Avatar`)
- Progress bar: child issue completion % (for epics)

**Interactions:**
- Drag cards between columns to change `roadmapBucketId` (PATCH issue)
- Drag to reorder within column
- Click card to open issue detail side panel
- Column management (admin): add, rename, reorder, delete, set color

**Default Setup:**
On first access to roadmap page when no buckets exist, show an empty state with:
- "Set up your roadmap" prompt
- Quick-start: create "Now", "Next", "Later" with one click
- Or "Customize" to define your own bucket names

### Roadmap Page

**URL:** `/:org/:team/:project/roadmap`

**Navigation:** New nav item between "Board" and "Backlog" in the project sidebar.

**Toolbar:**
- Mode toggle: `Timeline` | `Buckets` (segmented control using existing `Tabs` component)
- Zoom control (timeline only): Weeks | Months | Quarters
- Filter bar: assignee, label, type, milestone, sprint (reuse existing filter components)
- "Add to roadmap" button: opens issue picker to set dates or assign to bucket
- Bucket management (bucket view, admin only): "Manage Buckets" button

**What shows on the roadmap:**
- **Timeline:** any issue with at least a due date. Epics expand to children.
- **Buckets:** any issue with a `roadmapBucketId` set. Epics expand to children.
- An issue can appear in both views — timeline uses dates, bucket view uses bucket assignment. These are independent dimensions.

### Performance

- **Timeline:** query filters by project + has dates + loads issue links + children. Paginate by visible time window (load current viewport + 1 buffer on each side). Virtualize rows for projects with many epics.
- **Buckets:** load all bucketed issues for project. Bounded by project size (typically < 500 roadmap items). No pagination needed.
- **Dependency arrows:** compute layout client-side from link data. SVG overlay on the timeline canvas. Recalculate on scroll/zoom.

---

## 4. Shared Infrastructure

### Backend Module Pattern

Each feature follows the existing `src/modules/{feature}/` pattern:

```
src/modules/forms/
  forms.routes.ts
  forms.controller.ts
  forms.service.ts
  forms.validation.ts

src/modules/intake/
  intake.routes.ts
  intake.controller.ts
  intake.service.ts

src/modules/approvals/
  approvals.routes.ts
  approvals.controller.ts
  approvals.service.ts
  approvals.validation.ts

src/modules/roadmap/
  roadmap.routes.ts
  roadmap.controller.ts
  roadmap.service.ts
```

### Public Routes

The form submission routes (`/f/:formSlug/*`) are public and bypass JWT auth. They get their own Express router mounted before the auth middleware. Rate limiting and spam protection are applied at this layer.

### Notifications

All three features emit notifications via the existing notification system:
- **Forms:** "New form submission" to project members with intake access
- **Approvals:** "Approval requested" to nominated approvers, "Approved/Rejected" to requester
- **Roadmap:** no new notifications (changes are issue-level, covered by existing watchers)

### WebSocket Events

- `form:submission:created` — real-time intake queue updates
- `approval:request:created` — notify approvers
- `approval:request:resolved` — trigger board issue move on client

### Automation Integration

- New trigger: `form:submission:approved` — fires when an intake submission creates an issue, allowing automation rules to further route the new issue
- Approval resolution triggers existing `issue:status_changed` when the issue moves to the target column

---

## 5. New UI Components

All chart and visualization components are custom-built. No third-party chart libraries.

### Timeline / Gantt Components

```
frontend/src/components/ui/
  GanttChart.tsx         — Container: manages zoom, scroll, viewport, time axis calculations
  GanttTimeAxis.tsx      — Header row rendering time divisions (weeks/months/quarters) with gridlines
  GanttRow.tsx           — Single row: renders bar(s) for an issue, handles expand/collapse for epics
  GanttBar.tsx           — Individual bar: drag handles for resize/move, click, hover tooltip
  GanttMilestone.tsx     — Diamond marker for issues with only a due date
  DependencyArrow.tsx    — SVG path arrow between two bars, with violation color
  DependencyOverlay.tsx  — SVG overlay layer managing all arrows, hit testing for click/delete
  DragHandle.tsx         — Circle handle appearing on bar edges for creating dependency links
```

### Bucket View Components

```
frontend/src/components/ui/
  BucketBoard.tsx        — Container: renders columns, manages drag-and-drop between buckets
  BucketColumn.tsx       — Single column: header with name/count/color, droppable area
  RoadmapCard.tsx        — Issue card within a bucket: key, title, type, priority, assignee, progress
```

### Form Builder Components

```
frontend/src/components/ui/
  FormBuilder.tsx        — Container: page list + field editor, manages drag-and-drop reordering
  FormPageEditor.tsx     — Single page editor: title, condition config, field list
  FormFieldEditor.tsx    — Field config panel: type, label, required, validation, options, mapping
  FieldOptionEditor.tsx  — Options list editor for select/radio/multiselect fields
  BranchingConfig.tsx    — Page condition editor: field picker, operator, value
  FormPreview.tsx        — Renders the form as a user would see it, with page navigation
  FormWizard.tsx         — Public-facing multi-step form renderer (used on /f/:slug page)
  WizardProgress.tsx     — Step indicator for multi-page forms
```

### Approval Components

```
frontend/src/components/ui/
  ApprovalBadge.tsx      — Board card badge: amber (pending), red (rejected), with icon + tooltip
  ApprovalModal.tsx      — Nomination modal: approver picker, gate info, confirm
  ApprovalPanel.tsx      — Issue detail "Approvals" tab: request history, vote buttons, comments
  ApprovalVoteCard.tsx   — Single vote display: user, decision, comment, timestamp
```

### Shared / Reusable

```
frontend/src/components/ui/
  DragDropList.tsx       — Generic drag-and-drop reorderable list (used by form builder, bucket reorder)
  TimelineZoom.tsx       — Zoom level selector (Weeks/Months/Quarters) segmented control
  IssuePickerModal.tsx   — Modal to search/select issues (used by "Add to roadmap")
  ProgressBar.tsx        — Thin progress bar showing completion % (used in roadmap cards)
```

All components follow existing conventions:
- `forwardRef` pattern
- `cn()` for className merging
- CSS variable tokens only (no direct Tailwind palette colors)
- Lucide icons only
- Named exports
- Variant/size maps as objects
