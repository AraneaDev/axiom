/**
 * Seeds (or removes) a GitHub App row for the e2e run, sealed with the running container's key.
 * Runs inside the api container so it uses that container's database and secret key:
 *   docker compose -f docker-compose.dev.yml exec -T api npx tsx scripts/e2e-seed-github-app.ts [remove]
 * It is a script, never a route or an action. Values are invented, nothing here reaches GitHub.
 */
import '../src/config/load-env';
import './refuse-in-production';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

import { encryptSecret, secretContext } from '../src/lib/secret-box';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const ROW_ID = 1;
const sealed = (field: string, plain: string) =>
  encryptSecret(plain, secretContext('githubApp', field, String(ROW_ID)));

async function main() {
  if (process.argv[2] === 'remove') {
    await prisma.githubApp.deleteMany({ where: { id: ROW_ID } });
    console.log('GitHub App row removed');
    return;
  }
  const admin = await prisma.user.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!admin) throw new Error('No user to own the App row');
  const data = {
    appId: 123456,
    slug: 'axiom-e2e',
    name: 'Axiom e2e',
    htmlUrl: 'https://github.com/apps/axiom-e2e',
    ownerLogin: 'e2e-owner',
    clientId: 'Iv1.e2eclientid',
    clientSecret: sealed('clientSecret', 'e2e-client-secret'),
    privateKey: sealed('privateKey', 'e2e-private-key'),
    webhookSecret: sealed('webhookSecret', 'e2e-webhook-secret'),
    createdById: admin.id,
  };
  await prisma.githubApp.upsert({
    where: { id: ROW_ID },
    create: { id: ROW_ID, ...data },
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
