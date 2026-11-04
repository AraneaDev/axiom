import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

const TEST_DB_URL = 'postgresql://axiom:axiom_dev@localhost:5432/axiom_test?schema=public';

// Create a dedicated client for teardown use; avoids relying on DATABASE_URL
// being set in the globalSetup process context. The pool is kept so teardown can end it:
// $disconnect does not close a pool the adapter was given, and its idle connection would
// keep vitest from exiting ("close timed out").
const pool = new Pool({ connectionString: TEST_DB_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/**
 * Tables in child-first order (leaf tables before parent tables).
 * Uses the actual PostgreSQL table names from @@map directives in schema.prisma.
 * TRUNCATE ... CASCADE makes strict ordering optional, but this order
 * provides an extra safety net and documents the dependency graph.
 */
export const TRUNCATION_ORDER = [
  // Deep leaf nodes
  'page_views',
  'starred_pages',
  'issue_votes',
  'issue_watchers',
  'issue_web_links',
  'comment_reactions',
  'page_labels',
  'page_restrictions',
  'wiki_page_issue_links',
  'sprint_issue_history',
  'issue_links',
  'time_entries',
  'activities',
  'attachments',
  'saved_filters',
  'custom_field_values',
  'custom_field_definitions',
  'automation_rules',
  'workflow_rules',
  'audit_logs',
  'notifications',
  'notification_preferences',
  'page_comments',
  'page_versions',
  'pages',
  'space_permissions',
  'wiki_spaces',
  'page_templates',
  'comments',
  'labels',
  'milestones',
  'sprints',
  'board_columns',
  'issues',
  'projects',
  'team_memberships',
  'teams',
  'org_memberships',
  'invitations',
  'invite_links',
  'api_tokens',
  'refresh_tokens',
  'password_reset_tokens',
  'organizations',
  'users',
];

/**
 *
 */
export async function truncateAllTables(): Promise<void> {
  for (const table of TRUNCATION_ORDER) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
  }
}

/**
 *
 */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  await pool.end();
}
