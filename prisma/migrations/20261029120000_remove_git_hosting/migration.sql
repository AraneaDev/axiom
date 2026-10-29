-- Data cleanup for removed git features
-- Runs before the DROPs below. Rows that reference removed features are deleted
-- (or stripped of the removed values) so no reader meets an unknown value.

-- Notifications for pull requests.
DELETE FROM "notifications" WHERE "type" LIKE 'pr:%';

-- Notification preferences for pull request events.
DELETE FROM "notification_preferences" WHERE "eventType" LIKE 'pr\_%';

-- Automation rules that fire on removed triggers.
DELETE FROM "automation_rules" WHERE "trigger" IN ('pr:merged', 'workflow:completed', 'workflow:failed');

-- Automation rules: strip the removed run_workflow action.
UPDATE "automation_rules"
SET "actions" = COALESCE(
  (SELECT jsonb_agg(a) FROM jsonb_array_elements("actions"::jsonb) AS a WHERE a->>'type' IS DISTINCT FROM 'run_workflow'),
  '[]'::jsonb
)
WHERE jsonb_typeof("actions"::jsonb) = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements("actions"::jsonb) AS a WHERE a->>'type' = 'run_workflow');

-- Rules left with no actions do nothing; remove them.
DELETE FROM "automation_rules" WHERE "actions"::jsonb = '[]'::jsonb;

-- Activity on pull requests and repositories.
DELETE FROM "activities" WHERE "resourceType" IN ('pull_request', 'repository');

-- API tokens: strip repo:* scopes.
UPDATE "api_tokens"
SET "scopes" = ARRAY(SELECT s FROM unnest("scopes") AS s WHERE s NOT LIKE 'repo:%')
WHERE EXISTS (SELECT 1 FROM unnest("scopes") AS s WHERE s LIKE 'repo:%');

-- Audit log rows are history and stay untouched.
-- End data cleanup

-- DropForeignKey
ALTER TABLE "branch_protections" DROP CONSTRAINT "branch_protections_repoId_fkey";

-- DropForeignKey
ALTER TABLE "commit_statuses" DROP CONSTRAINT "commit_statuses_repoId_fkey";

-- DropForeignKey
ALTER TABLE "deployment_environments" DROP CONSTRAINT "deployment_environments_repoId_fkey";

-- DropForeignKey
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_deployedById_fkey";

-- DropForeignKey
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_environmentId_fkey";

-- DropForeignKey
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_pipelineRunId_fkey";

-- DropForeignKey
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_releaseId_fkey";

-- DropForeignKey
ALTER TABLE "environment_variables" DROP CONSTRAINT "environment_variables_environmentId_fkey";

-- DropForeignKey
ALTER TABLE "issue_branches" DROP CONSTRAINT "issue_branches_createdById_fkey";

-- DropForeignKey
ALTER TABLE "issue_branches" DROP CONSTRAINT "issue_branches_issueId_fkey";

-- DropForeignKey
ALTER TABLE "issue_branches" DROP CONSTRAINT "issue_branches_repoId_fkey";

-- DropForeignKey
ALTER TABLE "issue_commits" DROP CONSTRAINT "issue_commits_issueId_fkey";

-- DropForeignKey
ALTER TABLE "issue_commits" DROP CONSTRAINT "issue_commits_repoId_fkey";

-- DropForeignKey
ALTER TABLE "issue_pull_requests" DROP CONSTRAINT "issue_pull_requests_issueId_fkey";

-- DropForeignKey
ALTER TABLE "issue_pull_requests" DROP CONSTRAINT "issue_pull_requests_prId_fkey";

-- DropForeignKey
ALTER TABLE "pipeline_jobs" DROP CONSTRAINT "pipeline_jobs_runId_fkey";

-- DropForeignKey
ALTER TABLE "pipeline_runs" DROP CONSTRAINT "pipeline_runs_pipelineId_fkey";

-- DropForeignKey
ALTER TABLE "pipeline_runs" DROP CONSTRAINT "pipeline_runs_repoId_fkey";

-- DropForeignKey
ALTER TABLE "pipeline_runs" DROP CONSTRAINT "pipeline_runs_triggeredById_fkey";

-- DropForeignKey
ALTER TABLE "pipeline_steps" DROP CONSTRAINT "pipeline_steps_jobId_fkey";

-- DropForeignKey
ALTER TABLE "pipelines" DROP CONSTRAINT "pipelines_repoId_fkey";

-- DropForeignKey
ALTER TABLE "pr_comments" DROP CONSTRAINT "pr_comments_parentId_fkey";

-- DropForeignKey
ALTER TABLE "pr_comments" DROP CONSTRAINT "pr_comments_prId_fkey";

-- DropForeignKey
ALTER TABLE "pr_reviews" DROP CONSTRAINT "pr_reviews_prId_fkey";

-- DropForeignKey
ALTER TABLE "pull_requests" DROP CONSTRAINT "pull_requests_repoId_fkey";

-- DropForeignKey
ALTER TABLE "releases" DROP CONSTRAINT "releases_authorId_fkey";

-- DropForeignKey
ALTER TABLE "releases" DROP CONSTRAINT "releases_repoId_fkey";

-- DropForeignKey
ALTER TABLE "repositories" DROP CONSTRAINT "repositories_teamId_fkey";

-- DropForeignKey
ALTER TABLE "runner_task_logs" DROP CONSTRAINT "runner_task_logs_taskId_fkey";

-- DropForeignKey
ALTER TABLE "runner_tasks" DROP CONSTRAINT "runner_tasks_automationRuleId_fkey";

-- DropForeignKey
ALTER TABLE "runner_tasks" DROP CONSTRAINT "runner_tasks_issueId_fkey";

-- DropForeignKey
ALTER TABLE "runner_tasks" DROP CONSTRAINT "runner_tasks_repoId_fkey";

-- DropForeignKey
ALTER TABLE "runner_tasks" DROP CONSTRAINT "runner_tasks_runnerId_fkey";

-- DropForeignKey
ALTER TABLE "ssh_keys" DROP CONSTRAINT "ssh_keys_userId_fkey";

-- DropForeignKey
ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_webhookId_fkey";

-- DropForeignKey
ALTER TABLE "webhooks" DROP CONSTRAINT "webhooks_repoId_fkey";

-- DropTable
DROP TABLE "branch_protections";

-- DropTable
DROP TABLE "commit_statuses";

-- DropTable
DROP TABLE "deployment_environments";

-- DropTable
DROP TABLE "deployments";

-- DropTable
DROP TABLE "environment_variables";

-- DropTable
DROP TABLE "issue_branches";

-- DropTable
DROP TABLE "issue_commits";

-- DropTable
DROP TABLE "issue_pull_requests";

-- DropTable
DROP TABLE "pipeline_jobs";

-- DropTable
DROP TABLE "pipeline_runs";

-- DropTable
DROP TABLE "pipeline_steps";

-- DropTable
DROP TABLE "pipelines";

-- DropTable
DROP TABLE "pr_comments";

-- DropTable
DROP TABLE "pr_reviews";

-- DropTable
DROP TABLE "pull_requests";

-- DropTable
DROP TABLE "releases";

-- DropTable
DROP TABLE "repositories";

-- DropTable
DROP TABLE "runner_registration_tokens";

-- DropTable
DROP TABLE "runner_task_logs";

-- DropTable
DROP TABLE "runner_tasks";

-- DropTable
DROP TABLE "runners";

-- DropTable
DROP TABLE "ssh_keys";

-- DropTable
DROP TABLE "webhook_deliveries";

-- DropTable
DROP TABLE "webhooks";

-- DropEnum
DROP TYPE "CommitRefType";

-- DropEnum
DROP TYPE "CommitStatusState";

-- DropEnum
DROP TYPE "DeploymentStatus";

-- DropEnum
DROP TYPE "PRStatus";

-- DropEnum
DROP TYPE "RepoVisibility";

-- DropEnum
DROP TYPE "ReviewStatus";

-- DropEnum
DROP TYPE "RunStatus";

-- DropEnum
DROP TYPE "RunnerScope";

-- DropEnum
DROP TYPE "RunnerStatus";

-- DropEnum
DROP TYPE "TriggerType";
