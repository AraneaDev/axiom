// Every GitHub event handler is registered here and nowhere else. The API and the worker both
// import this file, so a delivery runs the same handlers in whichever process retries it: a
// process without a handler would mark the delivery IGNORED and lose it. A new handler module
// is imported here.
import { z } from 'zod';

import { prisma } from '../../config/database';

import { onGithubEvent, type GithubDeliveryContext } from './webhook-dispatch';

const installationPayload = z.object({
  action: z.string().optional(),
  installation: z.object({
    id: z.number().int(),
    account: z.object({ login: z.string().min(1), type: z.string().min(1) }),
    suspended_at: z.string().nullish(),
  }),
});

/**
 * Keeps an installation as the payload says, as `syncInstallations` writes it. A payload that is
 * not an installation's is none of this handler's business, and neither is an event older than
 * the row (deliveries can arrive late, after a retry); the sync repairs what that leaves behind.
 * @param d The delivery
 * @param suspendedAt What to store as the suspension: the payload's, now, or none
 */
async function writeInstallation(
  d: GithubDeliveryContext,
  suspendedAt: (fromPayload: Date | null) => Date | null,
): Promise<'processed' | 'ignored'> {
  const parsed = installationPayload.safeParse(d.payload);
  if (!parsed.success) return 'ignored';
  const { installation } = parsed.data;
  const fromPayload = installation.suspended_at ? new Date(installation.suspended_at) : null;
  const data = {
    accountLogin: installation.account.login,
    accountType: installation.account.type,
    suspendedAt: suspendedAt(fromPayload),
  };
  const known = await prisma.githubInstallation.findUnique({ where: { id: installation.id } });
  if (!known) {
    await prisma.githubInstallation.upsert({
      where: { id: installation.id },
      create: { id: installation.id, ...data },
      update: {},
    });
    return 'processed';
  }
  const { count } = await prisma.githubInstallation.updateMany({
    where: { id: installation.id, updatedAt: { lt: d.receivedAt } },
    data,
  });
  return count === 0 ? 'ignored' : 'processed';
}

onGithubEvent('installation', (d) => {
  switch (d.action) {
    // GitHub no longer has it: marked suspended, as the sync marks an installation it no longer lists
    case 'deleted':
      return writeInstallation(d, () => new Date());
    case 'suspend':
      return writeInstallation(d, (fromPayload) => fromPayload ?? new Date());
    case 'unsuspend':
      return writeInstallation(d, () => null);
    case 'created':
      return writeInstallation(d, (fromPayload) => fromPayload);
    default:
      return Promise.resolve('ignored');
  }
});

onGithubEvent('installation_repositories', (d) =>
  writeInstallation(d, (fromPayload) => fromPayload),
);
