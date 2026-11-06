-- GitHub numbers its ids as 64 bit integers: a repository id above 2^31 must fit
ALTER TABLE "github_apps" ALTER COLUMN "appId" SET DATA TYPE BIGINT;
ALTER TABLE "github_accounts" ALTER COLUMN "githubUserId" SET DATA TYPE BIGINT;
ALTER TABLE "github_installations" ALTER COLUMN "id" SET DATA TYPE BIGINT;
ALTER TABLE "github_deliveries" ALTER COLUMN "installationId" SET DATA TYPE BIGINT;
ALTER TABLE "github_deliveries" ALTER COLUMN "repoId" SET DATA TYPE BIGINT;
