/**
 * Comprehensive demo seed script for Axiom.
 *
 * Usage: npx tsx scripts/seed-demo.ts
 *
 * Creates a full demo environment with users, org, teams, projects,
 * issues, comments, wiki spaces, repositories, and pull requests.
 *
 * Safe to run multiple times (idempotent via upserts / existence checks).
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

// ─── Helpers ────────────────────────────────────────────────────

function futureDate(daysFromNow: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d;
}

function pastDate(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('Seeding demo data...\n');

  // ────────────────────────────────────────────────────────────
  // 1. Users
  // ────────────────────────────────────────────────────────────
  console.log('  [1/9] Users');
  const passwordHash = await bcrypt.hash('password123', 12);

  const userData = [
    { username: 'admin', displayName: 'Admin User', email: 'admin@axiom.local' },
    { username: 'sarah-chen', displayName: 'Sarah Chen', email: 'sarah@axiom.local' },
    { username: 'marcus-kim', displayName: 'Marcus Kim', email: 'marcus@axiom.local' },
    { username: 'anika-patel', displayName: 'Anika Patel', email: 'anika@axiom.local' },
    { username: 'alex-rivera', displayName: 'Alex Rivera', email: 'alex@axiom.local' },
  ] as const;

  const users: Record<string, { id: string }> = {};
  for (const u of userData) {
    const user = await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: { ...u, passwordHash },
    });
    users[u.username] = user;
    console.log(`        ${u.username} (${u.email})`);
  }

  // ────────────────────────────────────────────────────────────
  // 2. Organization + memberships
  // ────────────────────────────────────────────────────────────
  console.log('  [2/9] Organization');
  const org = await prisma.organization.upsert({
    where: { slug: 'axiom' },
    update: {},
    create: {
      name: 'Axiom',
      slug: 'axiom',
      description: 'Modern project management, Git hosting, and documentation platform',
    },
  });

  const orgRoles: Record<string, 'OWNER' | 'ADMIN' | 'MEMBER'> = {
    admin: 'OWNER',
    'sarah-chen': 'ADMIN',
    'marcus-kim': 'MEMBER',
    'anika-patel': 'MEMBER',
    'alex-rivera': 'MEMBER',
  };

  for (const [username, role] of Object.entries(orgRoles)) {
    await prisma.orgMembership.upsert({
      where: { userId_orgId: { userId: users[username].id, orgId: org.id } },
      update: { role },
      create: { userId: users[username].id, orgId: org.id, role },
    });
  }
  console.log(`        Axiom (${Object.keys(orgRoles).length} members)`);

  // ────────────────────────────────────────────────────────────
  // 3. Teams + memberships
  // ────────────────────────────────────────────────────────────
  console.log('  [3/9] Teams');

  const teamDefs = [
    {
      name: 'Core',
      slug: 'core',
      description: 'Core platform and API team',
      members: { admin: 'ADMIN' as const, 'sarah-chen': 'MEMBER' as const, 'anika-patel': 'MEMBER' as const },
    },
    {
      name: 'Frontend',
      slug: 'frontend',
      description: 'Frontend and design systems team',
      members: { 'marcus-kim': 'ADMIN' as const, 'sarah-chen': 'MEMBER' as const, 'anika-patel': 'MEMBER' as const },
    },
    {
      name: 'Infrastructure',
      slug: 'infra',
      description: 'Infrastructure, DevOps, and cloud team',
      members: { 'alex-rivera': 'ADMIN' as const, admin: 'MEMBER' as const },
    },
  ];

  const teams: Record<string, { id: string }> = {};
  for (const td of teamDefs) {
    const team = await prisma.team.upsert({
      where: { orgId_slug: { orgId: org.id, slug: td.slug } },
      update: {},
      create: { orgId: org.id, name: td.name, slug: td.slug, description: td.description },
    });
    teams[td.slug] = team;

    for (const [username, role] of Object.entries(td.members)) {
      await prisma.teamMembership.upsert({
        where: { userId_teamId: { userId: users[username].id, teamId: team.id } },
        update: { role },
        create: { userId: users[username].id, teamId: team.id, role },
      });
    }
    console.log(`        ${td.name} (${Object.keys(td.members).length} members)`);
  }

  // ────────────────────────────────────────────────────────────
  // 4. Projects + board columns + labels
  // ────────────────────────────────────────────────────────────
  console.log('  [4/9] Projects');

  const projectDefs = [
    { teamSlug: 'core', name: 'Platform', slug: 'platform', prefix: 'PLAT', description: 'Core platform development and services' },
    { teamSlug: 'core', name: 'API v2', slug: 'api-v2', prefix: 'API', description: 'Next-generation REST and GraphQL API' },
    { teamSlug: 'frontend', name: 'Design System', slug: 'design-system', prefix: 'DS', description: 'Shared component library and design tokens' },
    { teamSlug: 'frontend', name: 'Dashboard', slug: 'dashboard', prefix: 'DASH', description: 'Analytics and management dashboard' },
    { teamSlug: 'infra', name: 'Cloud Migration', slug: 'cloud-migration', prefix: 'CLD', description: 'AWS to multi-cloud migration initiative' },
  ];

  const columnDefs = [
    { name: 'Backlog', position: 0, isDefault: true, isDone: false },
    { name: 'Todo', position: 1, isDefault: false, isDone: false },
    { name: 'In Progress', position: 2, isDefault: false, isDone: false },
    { name: 'Review', position: 3, isDefault: false, isDone: false },
    { name: 'Done', position: 4, isDefault: false, isDone: true },
  ];

  const labelDefs = [
    { name: 'frontend', color: '#6366f1' },
    { name: 'backend', color: '#10b981' },
    { name: 'urgent', color: '#ef4444' },
    { name: 'docs', color: '#f59e0b' },
    { name: 'bug', color: '#dc2626' },
    { name: 'enhancement', color: '#8b5cf6' },
  ];

  const projects: Record<string, { id: string; teamSlug: string }> = {};
  const projectColumns: Record<string, Record<string, string>> = {}; // projectSlug -> columnName -> columnId
  const projectLabels: Record<string, Record<string, string>> = {};  // projectSlug -> labelName -> labelId

  for (const pd of projectDefs) {
    const teamId = teams[pd.teamSlug].id;

    const existing = await prisma.project.findUnique({
      where: { teamId_slug: { teamId, slug: pd.slug } },
    });

    let project: { id: string };
    if (existing) {
      project = existing;
    } else {
      project = await prisma.project.create({
        data: {
          teamId,
          name: pd.name,
          slug: pd.slug,
          prefix: pd.prefix,
          description: pd.description,
          columns: { createMany: { data: columnDefs } },
        },
      });
    }
    projects[pd.slug] = { id: project.id, teamSlug: pd.teamSlug };

    // Fetch columns
    const cols = await prisma.boardColumn.findMany({ where: { projectId: project.id } });
    projectColumns[pd.slug] = {};
    for (const c of cols) {
      projectColumns[pd.slug][c.name] = c.id;
    }

    // Upsert labels
    projectLabels[pd.slug] = {};
    for (const ld of labelDefs) {
      const label = await prisma.label.upsert({
        where: { projectId_name: { projectId: project.id, name: ld.name } },
        update: { color: ld.color },
        create: { projectId: project.id, name: ld.name, color: ld.color },
      });
      projectLabels[pd.slug][ld.name] = label.id;
    }

    console.log(`        ${pd.name} (${pd.prefix}) — ${pd.teamSlug}`);
  }

  // ────────────────────────────────────────────────────────────
  // 5. Issues
  // ────────────────────────────────────────────────────────────
  console.log('  [5/9] Issues');

  type IssueSeed = {
    title: string;
    body: string;
    type: 'TASK' | 'BUG' | 'STORY' | 'EPIC';
    priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    column: string;
    assignee?: string;
    creator: string;
    dueDate?: Date;
    labels?: string[];
  };

  const issuesByProject: Record<string, IssueSeed[]> = {
    platform: [
      { title: 'Implement rate limiting middleware', body: 'Add token-bucket rate limiting to all public API endpoints. Should support per-user and per-IP limits with configurable thresholds.', type: 'TASK', priority: 'HIGH', column: 'In Progress', assignee: 'sarah-chen', creator: 'admin', dueDate: futureDate(7), labels: ['backend'] },
      { title: 'Database connection pool exhaustion under load', body: 'Under sustained load (>500 rps), the connection pool is exhausted and requests start failing with `ETIMEDOUT`. Need to investigate pool sizing and query optimization.', type: 'BUG', priority: 'CRITICAL', column: 'Review', assignee: 'anika-patel', creator: 'sarah-chen', dueDate: futureDate(2), labels: ['backend', 'urgent'] },
      { title: 'User authentication flow redesign', body: 'Redesign the authentication flow to support SSO, OAuth2, and SAML providers. This is the umbrella story for the auth modernization effort.', type: 'STORY', priority: 'HIGH', column: 'In Progress', assignee: 'sarah-chen', creator: 'admin', dueDate: futureDate(21), labels: ['backend', 'frontend'] },
      { title: 'Platform observability and monitoring', body: 'Set up comprehensive observability: structured logging, distributed tracing with OpenTelemetry, and metrics dashboards in Grafana.', type: 'EPIC', priority: 'MEDIUM', column: 'Backlog', creator: 'admin', labels: ['backend', 'enhancement'] },
      { title: 'Fix CORS headers for external API consumers', body: 'External API consumers report that preflight requests are failing due to missing `Access-Control-Allow-Headers` for custom headers.', type: 'BUG', priority: 'HIGH', column: 'Todo', assignee: 'anika-patel', creator: 'sarah-chen', labels: ['backend', 'bug'] },
      { title: 'Add WebSocket support for real-time updates', body: 'Implement WebSocket connections for pushing real-time issue updates, notifications, and board changes to connected clients.', type: 'STORY', priority: 'MEDIUM', column: 'Backlog', creator: 'admin', labels: ['backend', 'enhancement'] },
      { title: 'Implement audit logging for compliance', body: 'All mutation operations need to generate audit log entries. Required for SOC 2 compliance.', type: 'TASK', priority: 'HIGH', column: 'Todo', assignee: 'sarah-chen', creator: 'admin', dueDate: futureDate(14), labels: ['backend'] },
      { title: 'Optimize full-text search performance', body: 'Search queries over large datasets (>100k issues) are slow. Consider adding PostgreSQL GIN indexes or integrating a dedicated search engine.', type: 'TASK', priority: 'MEDIUM', column: 'Backlog', creator: 'anika-patel', labels: ['backend', 'enhancement'] },
      { title: 'Set up database backup and recovery', body: 'Implement automated daily backups with point-in-time recovery. Document the restore procedure in runbooks.', type: 'TASK', priority: 'HIGH', column: 'Done', assignee: 'admin', creator: 'admin', labels: ['backend', 'docs'] },
      { title: 'Session management improvements', body: 'Add support for concurrent session limits, device tracking, and remote session revocation from the security settings page.', type: 'STORY', priority: 'LOW', column: 'Backlog', creator: 'sarah-chen', labels: ['backend', 'frontend'] },
    ],
    'api-v2': [
      { title: 'Design API v2 schema and endpoints', body: 'Define the OpenAPI 3.1 specification for API v2. Focus on resource consistency, pagination, and filtering patterns.', type: 'EPIC', priority: 'HIGH', column: 'In Progress', assignee: 'sarah-chen', creator: 'admin', dueDate: futureDate(14), labels: ['backend', 'docs'] },
      { title: 'Implement pagination with cursor-based navigation', body: 'Replace offset-based pagination with cursor-based pagination for all list endpoints. Use opaque cursors to avoid exposing internal IDs.', type: 'TASK', priority: 'HIGH', column: 'In Progress', assignee: 'anika-patel', creator: 'sarah-chen', labels: ['backend'] },
      { title: 'Add request validation middleware', body: 'Use Zod schemas to validate all incoming request bodies and query parameters. Return structured error responses with field-level details.', type: 'TASK', priority: 'MEDIUM', column: 'Todo', creator: 'sarah-chen', labels: ['backend'] },
      { title: 'API versioning strategy documentation', body: 'Document the versioning strategy: URL-based (`/v2/`), deprecation policy, and migration guides for v1 consumers.', type: 'TASK', priority: 'MEDIUM', column: 'Backlog', creator: 'admin', labels: ['docs'] },
      { title: 'Rate limit headers not included in responses', body: 'API responses are missing `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers. Consumers need these to implement proper backoff.', type: 'BUG', priority: 'MEDIUM', column: 'Todo', assignee: 'anika-patel', creator: 'sarah-chen', labels: ['backend', 'bug'] },
      { title: 'Implement bulk operations endpoint', body: 'Add `POST /v2/bulk` endpoint supporting batch create, update, and delete operations with transactional guarantees.', type: 'STORY', priority: 'LOW', column: 'Backlog', creator: 'admin', labels: ['backend', 'enhancement'] },
      { title: 'GraphQL gateway proof of concept', body: 'Build a proof-of-concept GraphQL layer on top of the REST API to evaluate developer experience and performance implications.', type: 'STORY', priority: 'LOW', column: 'Backlog', creator: 'sarah-chen', labels: ['backend', 'enhancement'] },
    ],
    'design-system': [
      { title: 'Set up Storybook for component development', body: 'Initialize Storybook 8 with Vite builder. Configure autodocs, theming, and accessibility addon.', type: 'TASK', priority: 'HIGH', column: 'Done', assignee: 'marcus-kim', creator: 'marcus-kim', labels: ['frontend'] },
      { title: 'Create Button component with variants', body: 'Build the base Button component with variants: primary, secondary, ghost, destructive. Include size options (sm, md, lg) and loading state.', type: 'TASK', priority: 'HIGH', column: 'Review', assignee: 'anika-patel', creator: 'marcus-kim', dueDate: futureDate(3), labels: ['frontend'] },
      { title: 'Design token system for colors and spacing', body: 'Define CSS custom properties for the design token system. Support light and dark themes with semantic color names.', type: 'STORY', priority: 'CRITICAL', column: 'In Progress', assignee: 'marcus-kim', creator: 'marcus-kim', dueDate: futureDate(5), labels: ['frontend'] },
      { title: 'Input and form field components', body: 'Create Input, Select, Checkbox, Radio, and TextArea components with consistent styling, validation states, and accessibility.', type: 'TASK', priority: 'HIGH', column: 'In Progress', assignee: 'anika-patel', creator: 'marcus-kim', labels: ['frontend'] },
      { title: 'Modal and dialog components', body: 'Build accessible modal/dialog components using `<dialog>` element. Support confirmation dialogs, form modals, and full-screen modals.', type: 'TASK', priority: 'MEDIUM', column: 'Todo', creator: 'marcus-kim', labels: ['frontend'] },
      { title: 'Icon system inconsistencies', body: 'Some icons are using different stroke widths and sizes. Need to audit all icons and standardize on 24px with 1.5px stroke.', type: 'BUG', priority: 'MEDIUM', column: 'Backlog', assignee: 'sarah-chen', creator: 'anika-patel', labels: ['frontend', 'bug'] },
      { title: 'Accessible color contrast audit', body: 'Run WCAG 2.1 AA contrast checks on all color combinations. Several text-on-background combinations may not meet the 4.5:1 ratio.', type: 'TASK', priority: 'HIGH', column: 'Todo', assignee: 'marcus-kim', creator: 'marcus-kim', dueDate: futureDate(10), labels: ['frontend', 'urgent'] },
      { title: 'Component documentation template', body: 'Create a standard documentation template for components: props table, usage examples, accessibility notes, and do/don\'t guidelines.', type: 'TASK', priority: 'LOW', column: 'Backlog', creator: 'marcus-kim', labels: ['frontend', 'docs'] },
    ],
    dashboard: [
      { title: 'Dashboard layout with responsive grid', body: 'Implement the main dashboard layout using CSS Grid with responsive breakpoints. Support customizable widget placement.', type: 'STORY', priority: 'HIGH', column: 'In Progress', assignee: 'marcus-kim', creator: 'marcus-kim', dueDate: futureDate(10), labels: ['frontend'] },
      { title: 'Project activity feed widget', body: 'Build a real-time activity feed showing recent issues, comments, and PR updates across all projects the user has access to.', type: 'TASK', priority: 'MEDIUM', column: 'Todo', assignee: 'anika-patel', creator: 'marcus-kim', labels: ['frontend', 'backend'] },
      { title: 'Issue statistics chart component', body: 'Create charts showing issue velocity, burndown, and distribution by type/priority. Use a lightweight charting library.', type: 'TASK', priority: 'MEDIUM', column: 'Backlog', creator: 'marcus-kim', labels: ['frontend', 'enhancement'] },
      { title: 'Dashboard crashes when project has no issues', body: 'Navigating to the dashboard for a project with zero issues throws a runtime error. The chart component receives an empty array and divides by zero.', type: 'BUG', priority: 'HIGH', column: 'Review', assignee: 'marcus-kim', creator: 'anika-patel', dueDate: futureDate(1), labels: ['frontend', 'bug'] },
      { title: 'Quick actions panel', body: 'Add a quick actions panel to the dashboard: create issue, search, jump to project, and recent items.', type: 'TASK', priority: 'LOW', column: 'Backlog', creator: 'marcus-kim', labels: ['frontend'] },
      { title: 'Dashboard performance optimization', body: 'Initial load time is over 3 seconds. Profile and optimize: lazy-load widgets, virtualize lists, and cache API responses.', type: 'TASK', priority: 'HIGH', column: 'In Progress', assignee: 'sarah-chen', creator: 'marcus-kim', labels: ['frontend', 'backend'] },
      { title: 'Keyboard navigation for dashboard widgets', body: 'Ensure all dashboard widgets are fully navigable with keyboard. Follow WAI-ARIA grid pattern for the widget layout.', type: 'STORY', priority: 'MEDIUM', column: 'Backlog', creator: 'anika-patel', labels: ['frontend'] },
    ],
    'cloud-migration': [
      { title: 'Terraform module for EKS cluster', body: 'Create reusable Terraform modules for provisioning EKS clusters with managed node groups, VPC, and IAM roles.', type: 'TASK', priority: 'CRITICAL', column: 'Review', assignee: 'alex-rivera', creator: 'alex-rivera', dueDate: futureDate(5), labels: ['backend'] },
      { title: 'Database migration to RDS Aurora', body: 'Plan and execute the migration from self-hosted PostgreSQL to RDS Aurora. Includes schema validation, data migration, and connection string updates.', type: 'EPIC', priority: 'HIGH', column: 'In Progress', assignee: 'alex-rivera', creator: 'admin', dueDate: futureDate(30), labels: ['backend'] },
      { title: 'CI/CD pipeline migration to GitHub Actions', body: 'Migrate from Jenkins to GitHub Actions. Create reusable workflows for build, test, deploy, and infrastructure changes.', type: 'STORY', priority: 'HIGH', column: 'In Progress', assignee: 'admin', creator: 'alex-rivera', labels: ['backend', 'enhancement'] },
      { title: 'SSL certificate auto-renewal failing', body: 'Cert-manager is not renewing Let\'s Encrypt certificates before expiry. The ClusterIssuer ACME solver is misconfigured for the new DNS provider.', type: 'BUG', priority: 'CRITICAL', column: 'Todo', assignee: 'alex-rivera', creator: 'admin', dueDate: futureDate(2), labels: ['backend', 'urgent', 'bug'] },
      { title: 'Set up monitoring with Prometheus and Grafana', body: 'Deploy Prometheus operator and Grafana to the monitoring namespace. Configure service monitors for all applications and create default dashboards.', type: 'TASK', priority: 'HIGH', column: 'Todo', creator: 'alex-rivera', labels: ['backend'] },
      { title: 'Cost optimization review', body: 'Review current AWS spending and identify optimization opportunities: reserved instances, right-sizing, spot instances for non-critical workloads.', type: 'TASK', priority: 'MEDIUM', column: 'Backlog', creator: 'admin', labels: ['docs'] },
      { title: 'Disaster recovery plan', body: 'Document and test the disaster recovery plan: multi-region failover, RTO/RPO targets, and automated recovery procedures.', type: 'STORY', priority: 'HIGH', column: 'Backlog', creator: 'alex-rivera', labels: ['docs', 'backend'] },
      { title: 'Container image scanning in CI', body: 'Integrate Trivy or Snyk into the CI pipeline to scan container images for vulnerabilities before pushing to ECR.', type: 'TASK', priority: 'MEDIUM', column: 'Backlog', creator: 'alex-rivera', labels: ['backend', 'enhancement'] },
      { title: 'Service mesh evaluation', body: 'Evaluate Istio vs Linkerd for service mesh. Consider performance overhead, observability features, and operational complexity.', type: 'TASK', priority: 'LOW', column: 'Backlog', assignee: 'alex-rivera', creator: 'alex-rivera', labels: ['backend'] },
      { title: 'Migrate secrets to AWS Secrets Manager', body: 'Move all application secrets from Kubernetes Secrets to AWS Secrets Manager with external-secrets operator for syncing.', type: 'TASK', priority: 'HIGH', column: 'Done', assignee: 'alex-rivera', creator: 'admin', labels: ['backend'] },
      { title: 'Load testing infrastructure', body: 'Set up k6 load testing infrastructure with automated runs against staging. Store results in InfluxDB for trend analysis.', type: 'TASK', priority: 'MEDIUM', column: 'Done', assignee: 'admin', creator: 'alex-rivera', labels: ['backend', 'enhancement'] },
    ],
  };

  // Team members lookup for each project
  const projectTeamMembers: Record<string, string[]> = {
    platform: ['admin', 'sarah-chen', 'anika-patel'],
    'api-v2': ['admin', 'sarah-chen', 'anika-patel'],
    'design-system': ['marcus-kim', 'sarah-chen', 'anika-patel'],
    dashboard: ['marcus-kim', 'sarah-chen', 'anika-patel'],
    'cloud-migration': ['alex-rivera', 'admin'],
  };

  // Track created issues for comments later
  const createdIssues: { id: string; projectSlug: string; title: string }[] = [];
  let totalIssues = 0;

  for (const [projectSlug, issues] of Object.entries(issuesByProject)) {
    const projectId = projects[projectSlug].id;
    const cols = projectColumns[projectSlug];
    const lbls = projectLabels[projectSlug];

    // Get max existing issue number for this project
    const maxIssue = await prisma.issue.findFirst({
      where: { projectId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    let nextNumber = (maxIssue?.number ?? 0) + 1;

    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];

      // Idempotency: check if issue already exists
      const existing = await prisma.issue.findFirst({
        where: { projectId, title: issue.title },
      });
      if (existing) {
        createdIssues.push({ id: existing.id, projectSlug, title: issue.title });
        totalIssues++;
        continue;
      }
      const number = nextNumber++;


      const labelIds = (issue.labels ?? [])
        .filter((l) => lbls[l])
        .map((l) => ({ id: lbls[l] }));

      const created = await prisma.issue.create({
        data: {
          projectId,
          number,
          title: issue.title,
          body: issue.body,
          type: issue.type,
          priority: issue.priority,
          columnId: cols[issue.column] ?? cols['Backlog'],
          assigneeId: issue.assignee ? users[issue.assignee].id : undefined,
          creatorId: users[issue.creator].id,
          dueDate: issue.dueDate ?? null,
          position: i,
          labels: { connect: labelIds },
        },
      });
      createdIssues.push({ id: created.id, projectSlug, title: issue.title });
      totalIssues++;
    }
  }
  console.log(`        ${totalIssues} issues across ${Object.keys(issuesByProject).length} projects`);

  // ────────────────────────────────────────────────────────────
  // 6. Comments
  // ────────────────────────────────────────────────────────────
  console.log('  [6/9] Comments');

  type CommentSeed = {
    issueTitle: string;
    projectSlug: string;
    comments: { author: string; body: string }[];
  };

  const commentSeeds: CommentSeed[] = [
    {
      issueTitle: 'Implement rate limiting middleware',
      projectSlug: 'platform',
      comments: [
        { author: 'anika-patel', body: 'I looked into this — we could use the `express-rate-limit` package as a starting point, but for production we should back it with Redis for distributed rate limiting across multiple instances.' },
        { author: 'sarah-chen', body: 'Agreed on Redis. Let\'s use a sliding window algorithm. I\'ve started a draft implementation:\n\n```typescript\nconst rateLimiter = new SlidingWindowRateLimiter({\n  windowMs: 60_000,\n  max: 100,\n  store: new RedisStore({ client: redis }),\n});\n```\n\nWill push a branch today.' },
        { author: 'admin', body: 'Make sure we have different limits for authenticated vs. unauthenticated requests. See the [API design doc](/axiom/core/wiki/docs/api-reference) for the proposed limits.' },
      ],
    },
    {
      issueTitle: 'Database connection pool exhaustion under load',
      projectSlug: 'platform',
      comments: [
        { author: 'sarah-chen', body: 'I was able to reproduce this in staging. The issue is that long-running transactions in the report generation endpoint are holding connections for 10+ seconds. We need to:\n\n1. Move report generation to a background job\n2. Increase pool size from 10 to 25\n3. Add connection timeout of 5s' },
        { author: 'anika-patel', body: 'Fix is up for review in PR #2. I went with PgBouncer in transaction mode as an additional layer. Staging tests show the pool stays healthy up to 1200 rps now.' },
      ],
    },
    {
      issueTitle: 'Design token system for colors and spacing',
      projectSlug: 'design-system',
      comments: [
        { author: 'sarah-chen', body: 'For the dark theme, can we make sure we use semantic names like `--color-surface-primary` instead of `--color-gray-900`? That way the tokens map correctly regardless of the active theme.' },
        { author: 'marcus-kim', body: 'Absolutely. Here\'s the naming convention I\'m going with:\n\n| Token | Light | Dark |\n|-------|-------|------|\n| `--color-surface-primary` | `#ffffff` | `#0f172a` |\n| `--color-surface-secondary` | `#f8fafc` | `#1e293b` |\n| `--color-text-primary` | `#0f172a` | `#f8fafc` |\n\nFull spec in the design wiki.' },
      ],
    },
    {
      issueTitle: 'Create Button component with variants',
      projectSlug: 'design-system',
      comments: [
        { author: 'marcus-kim', body: 'Looking good! Two things from my review:\n\n1. The loading spinner should use `currentColor` so it matches the text color of each variant\n2. Can we add `aria-busy="true"` when the button is in loading state?' },
        { author: 'anika-patel', body: 'Good catch on both. Updated the PR. Also added keyboard focus ring styles using `:focus-visible`.' },
      ],
    },
    {
      issueTitle: 'Dashboard crashes when project has no issues',
      projectSlug: 'dashboard',
      comments: [
        { author: 'marcus-kim', body: 'The root cause is in `IssueChart.tsx` line 42 — we compute `completionRate = done / total` without checking for `total === 0`. Simple guard clause should fix it.' },
        { author: 'anika-patel', body: 'I\'ll add null checks throughout the chart components and also add an empty state illustration for when there\'s no data to display.' },
      ],
    },
    {
      issueTitle: 'Dashboard layout with responsive grid',
      projectSlug: 'dashboard',
      comments: [
        { author: 'sarah-chen', body: 'The grid layout looks great on desktop but the widgets overlap at the `md` breakpoint. Can we switch to a single column below 768px?' },
      ],
    },
    {
      issueTitle: 'Terraform module for EKS cluster',
      projectSlug: 'cloud-migration',
      comments: [
        { author: 'admin', body: 'Alex, make sure we pin the EKS version to 1.28 for now. We should also enable the EBS CSI driver addon and configure IRSA for pod-level IAM.' },
        { author: 'alex-rivera', body: 'Done. I also added:\n\n- Cluster autoscaler with priorities for spot vs on-demand\n- Karpenter as an alternative provisioner\n- VPC CNI with prefix delegation for higher pod density\n\nTerraform plan looks clean. Ready for review.' },
      ],
    },
    {
      issueTitle: 'SSL certificate auto-renewal failing',
      projectSlug: 'cloud-migration',
      comments: [
        { author: 'alex-rivera', body: 'Found the issue — when we switched DNS to Route53, the cert-manager ClusterIssuer still had the old Cloudflare DNS01 solver config. Updating to use the Route53 solver with the correct IAM role.' },
      ],
    },
    {
      issueTitle: 'Design API v2 schema and endpoints',
      projectSlug: 'api-v2',
      comments: [
        { author: 'anika-patel', body: 'Should we follow JSON:API spec or go with a simpler custom format? JSON:API gives us standardized pagination, filtering, and relationships but adds verbosity.' },
        { author: 'sarah-chen', body: 'Let\'s go with a simplified approach inspired by JSON:API but without full compliance. We\'ll use:\n\n- `data` wrapper for responses\n- `meta` for pagination info\n- `?include=` for relationship loading\n- Standard error format with `errors[]` array' },
      ],
    },
    {
      issueTitle: 'CI/CD pipeline migration to GitHub Actions',
      projectSlug: 'cloud-migration',
      comments: [
        { author: 'alex-rivera', body: 'I\'ve mapped our Jenkins pipelines to GitHub Actions workflows:\n\n- `ci.yml` — lint, test, build on every PR\n- `deploy-staging.yml` — auto-deploy to staging on merge to main\n- `deploy-prod.yml` — manual approval + deploy to production\n- `infra.yml` — Terraform plan on PR, apply on merge\n\nReusable workflows are in `.github/workflows/`.' },
        { author: 'admin', body: 'Looks great. Let\'s also add a workflow for dependency updates via Dependabot and make sure we have branch protection requiring the CI check to pass.' },
      ],
    },
  ];

  let totalComments = 0;
  for (const cs of commentSeeds) {
    const issue = createdIssues.find(
      (i) => i.title === cs.issueTitle && i.projectSlug === cs.projectSlug,
    );
    if (!issue) continue;

    // Idempotency: check existing comment count
    const existingCount = await prisma.comment.count({ where: { issueId: issue.id } });
    if (existingCount >= cs.comments.length) continue;

    for (const c of cs.comments.slice(existingCount)) {
      await prisma.comment.create({
        data: {
          issueId: issue.id,
          authorId: users[c.author].id,
          body: c.body,
        },
      });
      totalComments++;
    }
  }
  console.log(`        ${totalComments} comments on ${commentSeeds.length} issues`);

  // ────────────────────────────────────────────────────────────
  // 7. Wiki spaces + pages + versions
  // ────────────────────────────────────────────────────────────
  console.log('  [7/9] Wiki spaces & pages');

  type PageSeed = {
    title: string;
    slug: string;
    body: string;
    position: number;
    author: string;
  };

  const wikiData: { teamSlug: string; name: string; slug: string; description: string; pages: PageSeed[] }[] = [
    {
      teamSlug: 'core',
      name: 'Documentation',
      slug: 'docs',
      description: 'Core platform documentation and guides',
      pages: [
        {
          title: 'Getting Started',
          slug: 'getting-started',
          position: 1,
          author: 'admin',
          body: `# Getting Started

Welcome to Axiom! This guide will help you get the platform running locally.

## Prerequisites

- Node.js >= 22.0.0
- PostgreSQL 16+
- Git 2.40+

## Installation

\`\`\`bash
# Clone the repository
git clone https://github.com/axiom/axiom.git
cd axiom

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your database credentials

# Initialize the database
npm run db:push
npm run db:setup-admin

# Start the development server
npm run dev
\`\`\`

## First Steps

1. Navigate to [http://localhost:5173/login](http://localhost:5173/login)
2. Log in with the admin credentials
3. Create your first project from the team dashboard
4. Invite team members via **Settings > Members**

## Project Structure

| Directory | Purpose |
|-----------|---------|
| \`src/\` | Backend API server (Express) |
| \`frontend/\` | React SPA (Vite) |
| \`prisma/\` | Database schema and migrations |
| \`scripts/\` | Utility scripts |

## Need Help?

- Check the [Architecture](/axiom/core/wiki/docs/architecture) page for system overview
- See [API Reference](/axiom/core/wiki/docs/api-reference) for endpoint documentation
- Read the [Contributing Guide](/axiom/core/wiki/docs/contributing) before submitting PRs`,
        },
        {
          title: 'Architecture',
          slug: 'architecture',
          position: 2,
          author: 'sarah-chen',
          body: `# Architecture Overview

Axiom follows a modular monolith architecture with clear domain boundaries.

## System Diagram

\`\`\`mermaid
graph TB
    Client[React SPA] -->|REST API| Gateway[Express Server]
    Gateway --> Auth[Auth Module]
    Gateway --> Issues[Issues Module]
    Gateway --> Wiki[Wiki Module]
    Gateway --> Git[Git Module]
    Auth --> DB[(PostgreSQL)]
    Issues --> DB
    Wiki --> DB
    Git --> Disk[(Git Repos)]
    Git --> DB
    Gateway --> WS[WebSocket Server]
    WS --> Client
\`\`\`

## Key Design Decisions

### Modular Monolith
We chose a modular monolith over microservices for simplicity. Each domain module has:
- Its own route handlers
- Service layer with business logic
- Prisma queries (shared client)

### Authentication
- JWT access tokens (15 min expiry)
- HTTP-only refresh tokens (7 day expiry)
- Optional 2FA with TOTP

### Git Hosting
- Bare repositories stored on disk
- Custom Git HTTP backend for push/pull
- SSH access via embedded SSH server

## Data Flow

\`\`\`mermaid
sequenceDiagram
    participant U as User
    participant A as API Server
    participant D as Database
    participant G as Git Storage

    U->>A: POST /api/issues
    A->>A: Validate & authorize
    A->>D: Insert issue
    D-->>A: Issue record
    A->>A: Emit WebSocket event
    A-->>U: 201 Created
\`\`\`

## Database Schema

The schema is managed with Prisma ORM. Key relationships:

- **Organization** has many **Teams**
- **Team** has many **Projects**, **Repositories**, and **WikiSpaces**
- **Project** has many **Issues** organized into **BoardColumns**
- **Repository** has many **PullRequests** with **Reviews** and **Comments**`,
        },
        {
          title: 'API Reference',
          slug: 'api-reference',
          position: 3,
          author: 'sarah-chen',
          body: `# API Reference

Base URL: \`/api/v1\`

All endpoints require authentication via Bearer token unless noted otherwise.

## Authentication

### POST /api/v1/auth/login

Authenticate and receive access/refresh tokens.

\`\`\`bash
curl -X POST http://localhost:3000/api/v1/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"username": "admin", "password": "password123"}'
\`\`\`

**Response:**
\`\`\`json
{
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG...",
  "user": {
    "id": "clx...",
    "username": "admin",
    "displayName": "Admin User"
  }
}
\`\`\`

## Issues

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | \`/issues\` | List issues (supports filtering, pagination) |
| POST | \`/issues\` | Create a new issue |
| GET | \`/issues/:id\` | Get issue by ID |
| PATCH | \`/issues/:id\` | Update issue fields |
| DELETE | \`/issues/:id\` | Delete an issue |
| POST | \`/issues/:id/comments\` | Add a comment |

### Filtering

\`\`\`
GET /api/v1/issues?type=BUG&priority=CRITICAL&assignee=me&status=open
\`\`\`

### Pagination

\`\`\`
GET /api/v1/issues?page=2&limit=25&sort=-createdAt
\`\`\`

## Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | \`/projects\` | List projects |
| POST | \`/projects\` | Create project |
| GET | \`/projects/:id\` | Get project details |
| GET | \`/projects/:id/board\` | Get board with columns and issues |

## Error Format

All errors follow a consistent format:

\`\`\`json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "title", "message": "Title is required" }
    ]
  }
}
\`\`\``,
        },
        {
          title: 'Contributing Guide',
          slug: 'contributing',
          position: 4,
          author: 'admin',
          body: `# Contributing Guide

Thank you for contributing to Axiom! This guide covers our development workflow and standards.

## Development Workflow

1. **Pick an issue** from the project board
2. **Create a branch** from \`main\`: \`git checkout -b feature/PLAT-123-short-description\`
3. **Make changes** following our coding standards
4. **Write tests** for new functionality
5. **Open a PR** with a clear description
6. **Address review feedback**
7. **Merge** once approved

## Branch Naming

\`\`\`
feature/PLAT-123-description   # New features
fix/PLAT-456-description       # Bug fixes
docs/PLAT-789-description      # Documentation
refactor/description            # Refactoring
\`\`\`

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

\`\`\`
feat(issues): add bulk update endpoint
fix(auth): handle expired refresh tokens gracefully
docs(api): update rate limiting documentation
test(wiki): add page versioning tests
\`\`\`

## Code Standards

- **TypeScript** strict mode enabled
- **ESLint** + **Prettier** for formatting
- **Vitest** for unit and integration tests
- Minimum **80%** test coverage for new code

## Pull Request Checklist

- [ ] Tests pass locally (\`npm run test:run\`)
- [ ] Linting passes (\`npm run lint\`)
- [ ] Types check (\`npm run typecheck\`)
- [ ] PR description explains the "why"
- [ ] Documentation updated if needed
- [ ] No console.log statements left behind

## Getting Help

- Tag \`@sarah-chen\` for API/backend questions
- Tag \`@marcus-kim\` for frontend/design questions
- Tag \`@alex-rivera\` for infrastructure questions`,
        },
      ],
    },
    {
      teamSlug: 'frontend',
      name: 'Design',
      slug: 'design',
      description: 'Design system documentation and guidelines',
      pages: [
        {
          title: 'Design Principles',
          slug: 'design-principles',
          position: 1,
          author: 'marcus-kim',
          body: `# Design Principles

These principles guide every design decision in Axiom.

## 1. Clarity Over Cleverness

Every interface element should be immediately understandable. Avoid ambiguous icons, clever animations, or hidden functionality.

**Do:**
- Use clear, descriptive labels
- Show confirmation dialogs for destructive actions
- Provide inline help text for complex fields

**Don't:**
- Rely solely on icons without labels
- Use jargon in user-facing copy
- Hide important actions in overflow menus

## 2. Progressive Disclosure

Show essential information first, details on demand. Reduce cognitive load by layering complexity.

**Examples:**
- Issue list shows title + status; click to expand full details
- Settings page groups options into logical sections
- Advanced filters are collapsed by default

## 3. Consistent Patterns

Use the same interaction patterns throughout the application. When a user learns one pattern, it should work everywhere.

| Pattern | Usage |
|---------|-------|
| Click to select, double-click to edit | Lists, tables |
| Drag and drop | Board columns, page reordering |
| Inline editing | Issue titles, column names |
| Command palette (\`Cmd+K\`) | Global navigation |

## 4. Accessible by Default

Accessibility is not an afterthought. Every component must meet WCAG 2.1 AA standards.

- All interactive elements are keyboard navigable
- Color is never the only way to convey information
- Focus indicators are always visible
- Screen reader announcements for dynamic content

## 5. Performance is a Feature

Perceived performance directly impacts user experience.

- Optimistic UI updates for mutations
- Skeleton loading states (not spinners)
- Virtualized lists for large datasets
- Prefetch data on hover`,
        },
        {
          title: 'Component Library',
          slug: 'component-library',
          position: 2,
          author: 'marcus-kim',
          body: `# Component Library

Our component library is built with React and follows the design token system.

## Component Categories

### Layout
- \`Container\` — Max-width wrapper with responsive padding
- \`Stack\` — Vertical/horizontal flex layout with gap
- \`Grid\` — CSS Grid layout with responsive columns
- \`Sidebar\` — Collapsible sidebar layout

### Forms
- \`Input\` — Text input with validation states
- \`Select\` — Custom select with search
- \`Checkbox\` / \`Radio\` — Selection controls
- \`TextArea\` — Multi-line text input
- \`DatePicker\` — Date/time selection

### Feedback
- \`Toast\` — Temporary notifications
- \`Alert\` — Persistent inline messages
- \`Modal\` — Dialog overlays
- \`Tooltip\` — Contextual help text

### Data Display
- \`Table\` — Sortable, filterable data table
- \`Badge\` — Status indicators
- \`Avatar\` — User avatars with fallback
- \`Card\` — Content container

## Usage Example

\`\`\`tsx
import { Button, Stack, Input } from '@axiom/ui';

function CreateIssueForm() {
  return (
    <Stack gap="md">
      <Input
        label="Title"
        placeholder="Issue title"
        required
      />
      <TextArea
        label="Description"
        placeholder="Describe the issue..."
        rows={4}
      />
      <Stack direction="horizontal" gap="sm">
        <Button variant="primary">Create Issue</Button>
        <Button variant="ghost">Cancel</Button>
      </Stack>
    </Stack>
  );
}
\`\`\`

## Storybook

Browse the full component library at [http://localhost:6006](http://localhost:6006)

Run locally:
\`\`\`bash
npm run storybook
\`\`\``,
        },
        {
          title: 'Color System',
          slug: 'color-system',
          position: 3,
          author: 'marcus-kim',
          body: `# Color System

Our color system uses semantic tokens that adapt to light and dark themes.

## Semantic Tokens

### Surfaces

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| \`--surface-primary\` | \`#ffffff\` | \`#0f172a\` | Main background |
| \`--surface-secondary\` | \`#f8fafc\` | \`#1e293b\` | Cards, panels |
| \`--surface-tertiary\` | \`#f1f5f9\` | \`#334155\` | Hover states |
| \`--surface-elevated\` | \`#ffffff\` | \`#1e293b\` | Modals, dropdowns |

### Text

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| \`--text-primary\` | \`#0f172a\` | \`#f8fafc\` | Headings, body |
| \`--text-secondary\` | \`#475569\` | \`#94a3b8\` | Descriptions |
| \`--text-muted\` | \`#94a3b8\` | \`#64748b\` | Timestamps |
| \`--text-inverse\` | \`#ffffff\` | \`#0f172a\` | On colored backgrounds |

### Brand & Status Colors

\`\`\`css
/* Brand */
--color-primary: #6366f1;      /* Indigo — primary actions */
--color-primary-hover: #4f46e5;

/* Status */
--color-success: #10b981;      /* Green — success, done */
--color-warning: #f59e0b;      /* Amber — warnings, in progress */
--color-error: #ef4444;        /* Red — errors, critical */
--color-info: #3b82f6;         /* Blue — information */

/* Priority */
--priority-critical: #dc2626;
--priority-high: #f97316;
--priority-medium: #eab308;
--priority-low: #6b7280;
\`\`\`

## Usage in Components

\`\`\`tsx
// Always use semantic tokens, never raw color values
<div style={{ background: 'var(--surface-primary)' }}>
  <p style={{ color: 'var(--text-primary)' }}>
    This adapts to light/dark theme automatically.
  </p>
</div>
\`\`\`

## Contrast Requirements

All text/background combinations meet WCAG 2.1 AA:
- Normal text: minimum 4.5:1 contrast ratio
- Large text (18px+): minimum 3:1 contrast ratio
- UI components: minimum 3:1 contrast ratio`,
        },
      ],
    },
    {
      teamSlug: 'infra',
      name: 'Runbooks',
      slug: 'runbooks',
      description: 'Operational runbooks and incident procedures',
      pages: [
        {
          title: 'Deployment',
          slug: 'deployment',
          position: 1,
          author: 'alex-rivera',
          body: `# Deployment Runbook

## Environments

| Environment | URL | Cluster | Branch |
|-------------|-----|---------|--------|
| Development | localhost:5173 | local | any |
| Staging | staging.axiom.dev | eks-staging | main |
| Production | app.axiom.dev | eks-prod | release/* |

## Staging Deployment

Staging deploys automatically on merge to \`main\`.

### Manual Staging Deploy

\`\`\`bash
# 1. Ensure you're on main
git checkout main && git pull

# 2. Build and push container
docker build -t axiom-api:latest .
docker tag axiom-api:latest ECR_REPO/axiom-api:sha-$(git rev-parse --short HEAD)
docker push ECR_REPO/axiom-api:sha-$(git rev-parse --short HEAD)

# 3. Update Kubernetes deployment
kubectl -n staging set image deployment/axiom-api \\
  axiom-api=ECR_REPO/axiom-api:sha-$(git rev-parse --short HEAD)

# 4. Watch rollout
kubectl -n staging rollout status deployment/axiom-api
\`\`\`

## Production Deployment

Production requires manual approval in GitHub Actions.

### Pre-deployment Checklist

- [ ] All staging tests passing
- [ ] No critical alerts in monitoring
- [ ] Database migrations reviewed and tested
- [ ] Rollback plan documented
- [ ] On-call engineer notified

### Deploy Steps

\`\`\`bash
# 1. Create release branch
git checkout -b release/v$(date +%Y%m%d) main

# 2. Run production deploy workflow
gh workflow run deploy-prod.yml --ref release/v$(date +%Y%m%d)

# 3. Monitor deployment
kubectl -n production rollout status deployment/axiom-api --timeout=300s

# 4. Verify health checks
curl -f https://app.axiom.dev/api/health || echo "HEALTH CHECK FAILED"
\`\`\`

### Rollback

\`\`\`bash
# Immediate rollback to previous version
kubectl -n production rollout undo deployment/axiom-api

# Verify rollback
kubectl -n production rollout status deployment/axiom-api
\`\`\`

## Database Migrations

\`\`\`bash
# Preview migration
npx prisma migrate diff --from-migrations-directory prisma/migrations --to-schema-datamodel prisma/schema.prisma

# Apply to staging
DATABASE_URL=\$STAGING_DB_URL npx prisma migrate deploy

# Apply to production (after staging validation)
DATABASE_URL=\$PROD_DB_URL npx prisma migrate deploy
\`\`\``,
        },
        {
          title: 'Incident Response',
          slug: 'incident-response',
          position: 2,
          author: 'alex-rivera',
          body: `# Incident Response

## Severity Levels

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| **SEV-1** | Complete outage | 15 minutes | App down, data loss |
| **SEV-2** | Major degradation | 30 minutes | Auth broken, >50% errors |
| **SEV-3** | Minor issue | 2 hours | Slow queries, UI glitch |
| **SEV-4** | Cosmetic | Next business day | Typo, minor styling |

## Incident Commander Responsibilities

1. **Assess** — Determine severity and impact
2. **Communicate** — Post in #incidents Slack channel
3. **Coordinate** — Assign responders to investigation
4. **Resolve** — Drive to resolution
5. **Review** — Schedule post-mortem within 48 hours

## Quick Diagnosis

### Application Not Responding

\`\`\`bash
# Check pod status
kubectl -n production get pods -l app=axiom-api

# Check recent logs
kubectl -n production logs -l app=axiom-api --tail=100 --since=5m

# Check resource usage
kubectl -n production top pods -l app=axiom-api
\`\`\`

### Database Issues

\`\`\`bash
# Check connection count
psql -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'axiom';"

# Find long-running queries
psql -c "SELECT pid, now() - query_start AS duration, query
         FROM pg_stat_activity
         WHERE state = 'active' AND query_start < now() - interval '30 seconds'
         ORDER BY duration DESC;"

# Kill runaway query (use with caution)
psql -c "SELECT pg_terminate_backend(<pid>);"
\`\`\`

### High Error Rate

\`\`\`bash
# Check error rate in Grafana
open "https://grafana.axiom.dev/d/api-overview?from=now-1h"

# Tail error logs
kubectl -n production logs -l app=axiom-api --tail=50 | grep "ERROR"
\`\`\`

## Post-Mortem Template

After resolution, create a post-mortem document:

1. **Summary** — What happened and impact
2. **Timeline** — Minute-by-minute events
3. **Root Cause** — Why it happened
4. **Resolution** — How it was fixed
5. **Action Items** — Preventive measures with owners and deadlines

## Escalation Contacts

| Role | Primary | Backup |
|------|---------|--------|
| Backend | Sarah Chen | Anika Patel |
| Infrastructure | Alex Rivera | Admin |
| Frontend | Marcus Kim | Sarah Chen |`,
        },
      ],
    },
  ];

  let totalPages = 0;
  for (const ws of wikiData) {
    const teamId = teams[ws.teamSlug].id;
    const space = await prisma.wikiSpace.upsert({
      where: { teamId_slug: { teamId, slug: ws.slug } },
      update: {},
      create: { teamId, name: ws.name, slug: ws.slug, description: ws.description },
    });

    for (const p of ws.pages) {
      const page = await prisma.page.upsert({
        where: { spaceId_slug: { spaceId: space.id, slug: p.slug } },
        update: { body: p.body, title: p.title },
        create: {
          spaceId: space.id,
          title: p.title,
          slug: p.slug,
          body: p.body,
          position: p.position,
        },
      });

      // Page version (idempotent)
      await prisma.pageVersion.upsert({
        where: { pageId_version: { pageId: page.id, version: 1 } },
        update: {},
        create: {
          pageId: page.id,
          version: 1,
          title: p.title,
          body: p.body,
          authorId: users[p.author].id,
        },
      });
      totalPages++;
    }
    console.log(`        ${ws.name} (${ws.pages.length} pages) — ${ws.teamSlug}`);
  }
  console.log(`        ${totalPages} pages total`);

  // ────────────────────────────────────────────────────────────
  // 8. Repositories
  // ────────────────────────────────────────────────────────────
  console.log('  [8/8] Repositories');

  // Self-referential: Axiom source code repo (bare clone of /root/axiom)
  {
    const selfReposBase = process.env.REPOS_PATH ?? '/data/repos';
    const selfDiskPath = path.join(selfReposBase, 'axiom', 'core', 'axiom.git');
    const coreTeamId = teams['core'].id;

    const selfRepo = await prisma.repository.upsert({
      where: { teamId_slug: { teamId: coreTeamId, slug: 'axiom' } },
      update: { diskPath: selfDiskPath, description: 'The Axiom platform source code' },
      create: {
        teamId: coreTeamId,
        name: 'axiom',
        slug: 'axiom',
        description: 'The Axiom platform source code',
        visibility: 'INTERNAL',
        diskPath: selfDiskPath,
        defaultBranch: 'master',
      },
    });

    // Create bare clone on disk if not already present.
    // When running inside the Docker container the source /root/axiom does not
    // exist, so we skip the git operations and rely on init-self-repo.sh having
    // been run on the host first.
    const isInsideDocker = fs.existsSync('/.dockerenv');
    const sourceExists = fs.existsSync('/root/axiom/.git');

    // Only attempt a bare clone when on the host and the source repo has commits.
    let sourceHasCommits = false;
    if (!isInsideDocker && sourceExists) {
      try {
        execSync('git -C /root/axiom rev-parse HEAD', { stdio: 'pipe' });
        sourceHasCommits = true;
      } catch { /* no commits yet */ }
    }

    if (sourceHasCommits) {
      if (!fs.existsSync(selfDiskPath)) {
        fs.mkdirSync(path.dirname(selfDiskPath), { recursive: true });
        execSync(`git clone --bare /root/axiom "${selfDiskPath}"`, { stdio: 'pipe' });
        console.log(`        axiom (INTERNAL) — created bare clone at ${selfDiskPath}`);
      } else {
        execSync(`git -C "${selfDiskPath}" fetch /root/axiom '+refs/heads/*:refs/heads/*' --tags --prune`, { stdio: 'ignore' });
        console.log(`        axiom (INTERNAL) — updated bare clone at ${selfDiskPath}`);
      }

      // Ensure bare repo accepts pushes
      execSync(`git -C "${selfDiskPath}" config receive.denyCurrentBranch ignore`, { stdio: 'ignore' });
    } else {
      console.log(`        axiom (INTERNAL) — DB record upserted (run scripts/init-self-repo.sh on host after committing)`);
    }

    // ── Dev API token for git push/pull ──
    // Use a deterministic token so the local .git/config remote stays valid across re-seeds.
    const DEV_TOKEN = 'tk_dev_axiom_local_0000000000000000000000000000000000000000000000';
    const devTokenHash = crypto.createHash('sha256').update(DEV_TOKEN).digest('hex');
    const devTokenPrefix = DEV_TOKEN.slice(0, 11);

    await prisma.apiToken.upsert({
      where: { tokenHash: devTokenHash },
      update: { name: 'dev-git-push' },
      create: {
        userId: users['admin'].id,
        name: 'dev-git-push',
        tokenHash: devTokenHash,
        prefix: devTokenPrefix,
        scopes: ['repo:read', 'repo:write'],
        expiresAt: null,
      },
    });

    // Set up git remote on host so pushes go through the Axiom server
    if (!isInsideDocker && sourceExists) {
      const remoteUrl = 'http://localhost:3000/git/axiom/core/axiom.git';
      try {
        const existingRemote = execSync('git -C /root/axiom remote get-url axiom 2>/dev/null', { encoding: 'utf8' }).trim();
        if (existingRemote !== remoteUrl) {
          execSync(`git -C /root/axiom remote set-url axiom "${remoteUrl}"`, { stdio: 'pipe' });
        }
      } catch {
        execSync(`git -C /root/axiom remote add axiom "${remoteUrl}"`, { stdio: 'pipe' });
      }

      // Configure git credential for the Axiom server
      execSync(`git -C /root/axiom config credential."http://localhost:3000".username admin`, { stdio: 'pipe' });
      execSync(`git -C /root/axiom config credential."http://localhost:3000".helper '!f() { echo "password=${DEV_TOKEN}"; }; f'`, { stdio: 'pipe' });

      console.log(`        dev API token created (deterministic)`);
      console.log(`        git remote "axiom" -> ${remoteUrl}`);
    }
  }

  console.log('\nDemo seed complete!');
  console.log('Login at http://localhost:5173/login');
  console.log('Credentials: admin / password123');
  console.log('Git push:    git push axiom master\n');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
