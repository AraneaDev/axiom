/**
 * Seeds (or removes) a GitHub App row for the e2e run, sealed with the running container's key.
 * Runs inside the api container so it uses that container's database and secret key:
 *   docker compose -f docker-compose.dev.yml exec -T api npx tsx scripts/e2e-seed-github-app.ts [remove]
 * It is a script, never a route or an action. It only runs against the axiom_e2e database and
 * only touches an App row whose slug is axiom-e2e. Values are invented, nothing reaches GitHub.
 */
import '../src/config/load-env';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

import { GITHUB_APP_ROW_ID, sealGithubAppSecret } from '../src/modules/github/github-app.service';

const E2E_DATABASE = 'axiom_e2e';
const E2E_SLUG = 'axiom-e2e';

const databaseName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, '');
  } catch {
    return '';
  }
})();
if (databaseName !== E2E_DATABASE) {
  console.error(`Refusing to run: DATABASE_URL names "${databaseName}", not ${E2E_DATABASE}`);
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const existing = await prisma.githubApp.findUnique({ where: { id: GITHUB_APP_ROW_ID } });
  if (existing && existing.slug !== E2E_SLUG) {
    throw new Error(`Refusing to touch the GitHub App row "${existing.slug}"`);
  }
  if (process.argv[2] === 'remove') {
    await prisma.githubApp.deleteMany({ where: { id: GITHUB_APP_ROW_ID, slug: E2E_SLUG } });
    console.log('GitHub App row removed');
    return;
  }
  const person = await prisma.user.findFirst({
    where: { kind: 'PERSON' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!person) throw new Error('No user to own the App row');
  const data = {
    appId: 123456,
    slug: E2E_SLUG,
    name: 'Axiom e2e',
    htmlUrl: 'https://github.com/apps/axiom-e2e',
    ownerLogin: 'e2e-owner',
    clientId: 'Iv1.e2eclientid',
    clientSecret: sealGithubAppSecret('clientSecret', 'e2e-client-secret'),
    privateKey: sealGithubAppSecret('privateKey', 'e2e-private-key'),
    webhookSecret: sealGithubAppSecret('webhookSecret', 'e2e-webhook-secret'),
    createdById: person.id,
  };
  await prisma.githubApp.upsert({
    where: { id: GITHUB_APP_ROW_ID },
    create: { id: GITHUB_APP_ROW_ID, ...data },
    update: data,
  });
  console.log('GitHub App row seeded');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
