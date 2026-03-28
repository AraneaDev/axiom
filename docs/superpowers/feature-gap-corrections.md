# Feature Gap Analysis: Corrections

Every item below is currently marked `[ ]` (missing) or `[~]` (partial) in `feature-gap-analysis.md` but actually EXISTS in the Axiom codebase. Each correction includes evidence.

---

## 1. Issue Tracking (vs Jira)

### Issue Types & Fields

```
CORRECTION: "Sub-tasks" should be [x] not [ ]
EVIDENCE: Found in prisma/schema.prisma:453-455 - Issue model has parentId/parent/children fields with "issueHierarchy" relation (generic, not epic-only).
EVIDENCE: Found in src/modules/issues/issue-hierarchy.service.ts - Full hierarchy service with setParent, removeParent, getChildren operations.
EVIDENCE: Found in frontend/src/pages/issues/ParentIssuePicker.tsx - Frontend UI for picking parent issues.
NOTE: The doc says "Axiom has epic-child hierarchy only, no generic sub-tasks" -- this is wrong. The parentId field is on all issues regardless of type.
```

```
CORRECTION: "Flagged/Impediment" should be [~] not [ ]
EVIDENCE: Found in prisma/schema.prisma:889-902 - CustomFieldDefinition model supports TEXT, NUMBER, DATE, SELECT, MULTI_SELECT, USER types.
EVIDENCE: Found in frontend/src/pages/projects/CustomFieldSettings.tsx:152 - References "boolean flags like 'Approved' or 'Reviewed'".
NOTE: While there's no dedicated "flagged" boolean, custom fields of type SELECT can implement this. Partial support.
```

### Boards

```
CORRECTION: "Swimlanes" should be [x] not [ ]
EVIDENCE: Found in frontend/src/pages/issues/Board.tsx:35-52 - Full SwimLane interface and groupIssues() function supporting groupBy assignee, priority, epic, type.
EVIDENCE: Found in frontend/src/pages/issues/BoardFilters.tsx:81-82 - GroupBy UI with dropdown for none/assignee/priority/type.
```

```
CORRECTION: "Board filtering" [~] should be [x]
EVIDENCE: Found in frontend/src/pages/issues/BoardFilters.tsx - Full board filtering (type, priority, assignee) with groupBy (swimlanes).
EVIDENCE: Found in frontend/src/pages/issues/IssueList.tsx:163-394 - Saved filters with create/delete/apply functionality using savedFiltersApi.
NOTE: The "no saved quick filters" comment is wrong -- SavedFilter model exists and is fully implemented.
```

### Sprints & Backlog

```
CORRECTION: "Sprint goal" should be [x] not [ ]
EVIDENCE: Found in prisma/schema.prisma:877 - Sprint model has goal String? field.
EVIDENCE: Found in src/modules/sprints/sprints.service.ts:31-39 - Sprint creation accepts goal parameter.
EVIDENCE: Found in frontend/src/pages/issues/SprintCard.tsx:172-310 - Full UI for viewing, editing, and saving sprint goals with inline editing.
```

```
CORRECTION: "Backlog ranking" should be [x] not [ ]
EVIDENCE: Found in prisma/schema.prisma:450 - Issue model has `position Int @default(0)` field for ordering.
EVIDENCE: Found in src/modules/issues/issues.service.ts:311,343 - position field is updateable via issue update endpoint.
EVIDENCE: Found in src/modules/issues/issues.controller.ts:108-113 - Controller accepts columnId + position for board moves.
```

```
CORRECTION: "Multiple future sprints" should be [x] not [ ]
EVIDENCE: Found in frontend/src/pages/issues/Backlog.tsx:211-213 - Sorts sprints: ACTIVE first, then PLANNING, then COMPLETED -- multiple planning sprints visible.
EVIDENCE: Found in prisma/schema.prisma:850-854 - SprintStatus enum has PLANNING, ACTIVE, COMPLETED states.
```

```
CORRECTION: "Incomplete issue handling" [~] should be [x]
EVIDENCE: Found in src/modules/sprints/sprints.service.ts:206-235 - completeSprint() fully implements moving incomplete issues to another sprint or backlog with moveToSprintId parameter.
```

### Notifications

```
CORRECTION: "@mentions" should be [x] not [ ]
EVIDENCE: Found in src/utils/mentions.ts - parseMentions() parses @username from text.
EVIDENCE: Found in src/utils/mention-notifier.ts - notifyMentions() creates notifications for mentioned users.
EVIDENCE: Found in frontend/src/components/editor/MentionExtension.ts - TipTap @mention extension with suggestion/autocomplete.
EVIDENCE: Found in frontend/src/components/editor/MentionList.tsx - Mention suggestion dropdown UI.
EVIDENCE: Found in src/email/templates.ts:20 - Email template for mention notifications.
```

```
CORRECTION: "Email notifications" should be [x] not [ ]
EVIDENCE: Found in src/email/queue.ts - Email queue system.
EVIDENCE: Found in src/modules/notifications/notifications.service.ts - Notification service with email integration.
EVIDENCE: Found in src/email/templates.ts - HTML email templates for various notification types including mentions.
```

### Reports (no corrections -- these are genuinely missing)

### Roadmaps & Timeline

```
CORRECTION: "Timeline view" should be [x] not [ ]
EVIDENCE: Found in frontend/src/pages/issues/Roadmap.tsx:171-314 - Full Gantt-style timeline view of epics with start/due dates, week markers, today marker, child issue progress bars.
EVIDENCE: Found in frontend/src/api/issues.api.ts - getRoadmap() API call.
```

### Automation

```
CORRECTION: "Automation rules" [~] should be [x] (more than basic)
EVIDENCE: Found in src/modules/automation/automation.service.ts:133-238 - Full automation engine with:
  - Trigger evaluation (matchesConditions)
  - Condition engine with field matching
  - Action execution: transition (columnId), assign (userId), add label, add comment
EVIDENCE: Found in prisma/schema.prisma:931-943 - AutomationRule model with trigger, conditions (JSON), actions (JSON), enabled flag.
```

```
CORRECTION: "Rich trigger types" should be [~] not [ ]
EVIDENCE: Found in src/modules/automation/automation.service.ts:140 - evaluateRules() accepts trigger parameter and matches against enabled rules.
NOTE: Partial because the trigger types may not cover all Jira events, but the infrastructure exists.
```

```
CORRECTION: "Condition engine" should be [~] not [ ]
EVIDENCE: Found in src/modules/automation/automation.service.ts:156-157 - matchesConditions() evaluates conditions array against context.
NOTE: Partial because it may not support full JQL-style conditions, but field matching exists.
```

```
CORRECTION: "Action library" should be [~] not [ ]
EVIDENCE: Found in src/modules/automation/automation.service.ts:193-238 - executeActions() supports: transition (set column), assign user, add label, add comment.
NOTE: Partial because it doesn't cover all Jira actions (email, Slack, create issue, etc.).
```

---

## 2. Wiki / Documentation (vs Confluence)

### Spaces & Pages

```
CORRECTION: "Page moving" should be [x] not [ ]
EVIDENCE: Found in src/modules/wiki/wiki.routes.ts:102 - POST /pages/:pageId/move route.
EVIDENCE: Found in src/modules/wiki/wiki.service.ts:330-365 - movePage() relocates to different parent/space with slug uniqueness and circular reference checks.
EVIDENCE: Found in src/modules/wiki/wiki.controller.ts:77-79 - movePage controller with validation.
```

```
CORRECTION: "Page copying" should be [x] not [ ]
EVIDENCE: Found in src/modules/wiki/wiki.routes.ts:103 - POST /pages/:pageId/copy route.
EVIDENCE: Found in src/modules/wiki/wiki.service.ts:375-379 - copyPage() duplicates to same or different space with new slug.
EVIDENCE: Found in src/modules/wiki/wiki.controller.ts:11 - copyPageSchema validation.
```

```
CORRECTION: "Unpublished drafts" should be [x] not [ ]
EVIDENCE: Found in prisma/schema.prisma:586 - Page model has `isDraft Boolean @default(false)` field.
EVIDENCE: Found in src/modules/wiki/wiki.service.ts:87,106,177,196 - isDraft supported in create and update operations.
```

### Editor & Content

```
CORRECTION: "Tables" should be [x] not [ ]
EVIDENCE: Found in frontend/src/components/editor/MarkdownEditor.tsx:5-8 - Imports Table, TableCell, TableHeader, TableRow from @tiptap.
EVIDENCE: Found in frontend/src/components/editor/MarkdownEditor.tsx:122-125 - Table configured with TableRow, TableCell, TableHeader extensions.
EVIDENCE: Found in frontend/src/components/editor/MarkdownEditor.tsx:183-184 - insertTable() with header rows (3x3 default).
EVIDENCE: Found in frontend/src/components/editor/CollaborativeEditor.tsx:13-16,129-132 - Same in collaborative editor.
```

```
CORRECTION: "Code blocks" should be [x] not [ ]
EVIDENCE: Found in frontend/src/components/editor/MarkdownEditor.tsx:1,127 - CodeBlockLowlight with syntax highlighting via lowlight.
EVIDENCE: Found in frontend/src/components/editor/MarkdownEditor.tsx:280-281 - Toggle code block toolbar button.
EVIDENCE: Found in frontend/src/components/editor/CollaborativeEditor.tsx:7 - Same in collaborative editor.
EVIDENCE: Found in frontend/src/components/editor/MermaidBlock.tsx - Mermaid diagram rendering in code blocks.
```

### Comments

```
CORRECTION: "Comment resolution" should be [x] not [ ]
EVIDENCE: Found in prisma/schema.prisma:1003 - PageComment model has `resolved Boolean @default(false)` field.
EVIDENCE: Found in src/modules/wiki/wiki-comments.service.ts:66-79 - resolveComment() toggles resolved status.
EVIDENCE: Found in src/modules/wiki/wiki-comments.controller.ts:31 - resolveComment endpoint.
```

```
CORRECTION: "@mentions in comments" should be [x] not [ ]
EVIDENCE: Found in frontend/src/components/editor/MentionExtension.ts - TipTap mention extension used in all editors (including comments).
EVIDENCE: Found in src/utils/mention-notifier.ts - Backend notification system for @mentions.
```

### Versioning & History (no version diff or restore found -- these remain [ ])

### Export

```
CORRECTION: "PDF export" should be [x] not [ ]
EVIDENCE: Found in src/modules/wiki/wiki-export.service.ts:17 - exportPage supports formats: html, docx, epub, pdf, latex, plain.
EVIDENCE: Found in src/modules/wiki/wiki.routes.ts:60 - Export route.
```

```
CORRECTION: "Word export" should be [x] not [ ]
EVIDENCE: Found in src/modules/wiki/wiki-export.service.ts:17 - exportPage supports docx format.
```

```
CORRECTION: "HTML export" should be [x] not [ ]
EVIDENCE: Found in src/modules/wiki/wiki-export.service.ts:17 - exportPage supports html format.
```

---

## 3. Git Hosting (vs Bitbucket)

### Repository Management

```
CORRECTION: "README rendering" should be [x] not [ ]
EVIDENCE: Found in frontend/src/pages/repos/RepoDetail.tsx:111-294 - Auto-detects README.md in file tree, fetches content, renders with MarkdownRenderer on repo landing page.
```

### Pull Requests

```
CORRECTION: "Close source branch" -- remains [ ], no auto-delete-on-merge found.
```

### Code Review

```
CORRECTION: "Code suggestions" should be [x] not [ ]
EVIDENCE: Found in src/modules/pulls/pull-comments.service.ts:27 - SUGGESTION_RE regex parses ```suggestion blocks.
EVIDENCE: Found in src/modules/pulls/pull-comments.service.ts:142-197 - applySuggestion() extracts suggestion, replaces lines in file, commits to source branch.
EVIDENCE: Found in src/modules/pulls/pulls.routes.ts:48-53 - Routes for single and batch suggestion apply.
EVIDENCE: Found in frontend/src/pages/repos/PRDetail.tsx:37-41,161-162 - Frontend toggleSuggestion and applySuggestion with one-click apply.
```

```
CORRECTION: "File tree in PR" -- partially exists for commits but not verified for PR diff view specifically. Remains [ ].
```

### Branch Protection

```
CORRECTION: "Minimum approvals count" should be [x] not [ ]
EVIDENCE: Found in prisma/schema.prisma:656 - BranchProtection has `requiredReviews Int @default(1)`.
EVIDENCE: Found in src/modules/pulls/pulls.service.ts:336-347 - Checks approvedCount >= requiredReviews before allowing merge.
EVIDENCE: Found in src/modules/repos/protection.service.ts:146-156 - Enforces minimum approval count with error message.
```

```
CORRECTION: "Force push restrictions" should be [x] not [ ]
EVIDENCE: Found in prisma/schema.prisma:658 - BranchProtection has `noForcePush Boolean @default(true)`.
EVIDENCE: Found in src/modules/repos/protection.service.ts:13,23,67,76 - noForcePush field in create and update operations.
```

```
CORRECTION: "Branch deletion restrictions" should be [~] not [ ]
EVIDENCE: Found in src/modules/repos/repos.service.ts:347-356 - deleteRepoBranch() prevents deleting the default branch.
NOTE: Partial because it only protects the default branch, not arbitrary branch patterns.
```

### CI/CD Pipelines

```
CORRECTION: "Pipeline config file" should be [~] not [ ]
EVIDENCE: Found in prisma/schema.prisma:770 - Pipeline model has `yamlContent String` field.
EVIDENCE: Found in src/modules/pipelines/pipelines.service.ts:42-43 - parsePipelineYaml() validates YAML configuration.
EVIDENCE: Found in src/modules/pipelines/pipeline-runner.ts:213 - Parses YAML at runtime.
NOTE: Partial because the YAML is stored in the database, not read from a file in the repo (like bitbucket-pipelines.yml).
```

```
CORRECTION: "Manual triggers" should be [x] not [ ]
EVIDENCE: Found in prisma/schema.prisma:690 - TriggerType enum includes MANUAL.
EVIDENCE: Found in src/modules/pipelines/pipelines.service.ts:140 - triggerType: 'MANUAL' when manually triggered.
```

### Deployments

```
CORRECTION: "Deployment gates" should be [~] not [ ]
EVIDENCE: Found in prisma/schema.prisma:1054 - DeploymentEnvironment has `protectionRules Json?` field.
EVIDENCE: Found in src/modules/deployments/deployments.service.ts:37-50 - protectionRules supported in create/update.
NOTE: Partial because the protection rules schema is flexible (Json?) but enforcement logic may not be fully implemented.
```

### Other Bitbucket Features

```
CORRECTION: "Code search" should be [x] not [ ]
EVIDENCE: Found in src/modules/search/search.routes.ts:11 - GET /code endpoint.
EVIDENCE: Found in src/modules/search/search.service.ts:480-483 - searchCode() function for cross-repo code search.
EVIDENCE: Found in src/modules/search/search.controller.ts:20-22 - searchCodeEndpoint controller with validation.
```

---

## 4. Cross-Product Integration Gaps

```
CORRECTION: "Cross-product search" should be [x] not [ ]
EVIDENCE: Found in src/modules/search/search.service.ts:130 - "Perform a cross-resource search across issues, wiki pages, repos, and code."
EVIDENCE: Found in frontend/src/pages/search/SearchResults.tsx - Search results page.
EVIDENCE: Found in frontend/src/api/search.api.ts - Search API client.
```

---

## Summary of All Corrections

| # | Feature | Current | Should Be | Section |
|---|---------|---------|-----------|---------|
| 1 | Sub-tasks | [ ] | [x] | Issue Types |
| 2 | Swimlanes | [ ] | [x] | Boards |
| 3 | Board filtering | [~] | [x] | Boards |
| 4 | Sprint goal | [ ] | [x] | Sprints |
| 5 | Backlog ranking | [ ] | [x] | Sprints |
| 6 | Multiple future sprints | [ ] | [x] | Sprints |
| 7 | Incomplete issue handling | [~] | [x] | Sprints |
| 8 | @mentions (issues) | [ ] | [x] | Notifications |
| 9 | Email notifications | [ ] | [x] | Notifications |
| 10 | Timeline view | [ ] | [x] | Roadmaps |
| 11 | Automation rules | [~] | [x] | Automation |
| 12 | Rich trigger types | [ ] | [~] | Automation |
| 13 | Condition engine | [ ] | [~] | Automation |
| 14 | Action library | [ ] | [~] | Automation |
| 15 | Page moving | [ ] | [x] | Wiki Spaces |
| 16 | Page copying | [ ] | [x] | Wiki Spaces |
| 17 | Unpublished drafts | [ ] | [x] | Wiki Spaces |
| 18 | Tables | [ ] | [x] | Wiki Editor |
| 19 | Code blocks | [ ] | [x] | Wiki Editor |
| 20 | Comment resolution | [ ] | [x] | Wiki Comments |
| 21 | @mentions in comments | [ ] | [x] | Wiki Comments |
| 22 | PDF export | [ ] | [x] | Wiki Export |
| 23 | Word export | [ ] | [x] | Wiki Export |
| 24 | HTML export | [ ] | [x] | Wiki Export |
| 25 | README rendering | [ ] | [x] | Repo Management |
| 26 | Code suggestions | [ ] | [x] | Code Review |
| 27 | Minimum approvals count | [ ] | [x] | Branch Protection |
| 28 | Force push restrictions | [ ] | [x] | Branch Protection |
| 29 | Branch deletion restrictions | [ ] | [~] | Branch Protection |
| 30 | Pipeline YAML config | [ ] | [~] | CI/CD |
| 31 | Manual triggers | [ ] | [x] | CI/CD |
| 32 | Deployment gates | [ ] | [~] | Deployments |
| 33 | Code search | [ ] | [x] | Bitbucket Other |
| 34 | Cross-product search | [ ] | [x] | Integration |
| 35 | Flagged/Impediment | [ ] | [~] | Issue Types |

**Total: 35 corrections (23 upgraded to [x], 7 upgraded to [~], 5 partial upgraded to [x])**
