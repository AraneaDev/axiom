// Every GitHub event handler is registered here and nowhere else. The API and the worker both
// import this file, so a delivery runs the same handlers in whichever process retries it: a
// process without a handler would mark the delivery IGNORED and lose it. A new handler module
// is imported here, and so is every outcome listener.
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../../config/database';

import './github-events';
import './github-realtime';
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
 * the newest one applied (deliveries can be processed late, after a retry); the sync repairs
 * what that leaves behind.
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
  // `lastEventAt` is the receivedAt of the newest event applied (or when the sync last ran), so
  // order follows when GitHub's calls arrived, not when a retry got to them. A tie applies. A
  // redelivery keeps its original receivedAt, so one that is older than the row is ignored as
  // stale, which is right: the event is old.
  const apply = () =>
    prisma.githubInstallation.updateMany({
      where: {
        id: installation.id,
        OR: [{ lastEventAt: null }, { lastEventAt: { lte: d.receivedAt } }],
      },
      data: { ...data, lastEventAt: d.receivedAt },
    });
  if ((await apply()).count > 0) return 'processed';
  try {
    await prisma.githubInstallation.create({
      data: { id: installation.id, ...data, lastEventAt: d.receivedAt },
    });
    return 'processed';
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    // The row exists (made by another delivery in the meantime, or newer than this event): judged against it
    return (await apply()).count > 0 ? 'processed' : 'ignored';
  }
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

const authorizationPayload = z.object({
  action: z.string().optional(),
  sender: z.object({ id: z.number().int() }),
});

// A person revoked the App's access on GitHub: their tokens are dead, so the connection goes. A
// connection made after the event was received (connectedAt is set by every connect, a reconnect
// that keeps the row included) is a newer act of theirs and stays, even when the delivery runs late.
onGithubEvent('github_app_authorization', async (d) => {
  if (d.action !== 'revoked') return 'ignored';
  const parsed = authorizationPayload.safeParse(d.payload);
  if (!parsed.success) return 'ignored';
  const { count } = await prisma.githubAccount.deleteMany({
    where: { githubUserId: parsed.data.sender.id, connectedAt: { lte: d.receivedAt } },
  });
  return count > 0 ? 'processed' : 'ignored';
});
