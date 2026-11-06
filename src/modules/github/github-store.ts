// The plumbing every GitHub store shares (branches, pull requests, reviews, commits, check runs).
// It registers nothing and listens to nothing, so any store can import it without taking in the
// event handlers of another.
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../../config/database';

import { resolveGithubActor } from './github-actor';
import { isUniqueViolation } from './github-errors';
import type { GithubEventOutcome } from './github-outcomes';
import { findRepoLinkByRepoId } from './repo-link.service';
import type { GithubDeliveryContext } from './webhook-dispatch';

/** Who did it on GitHub */
export type Sender = { id: number; login: string } | null;
export type StoreClient = Prisma.TransactionClient;

/** What a store was told of the event behind a change, as far as the outcome shows it */
export type OutcomeMeta = {
  event?: string;
  action?: string | null;
  payload?: Record<string, unknown>;
};

/**
 * Makes a text storable: Postgres refuses NUL, and a delivery that fails on it would fail on
 * every retry.
 * @param value The text
 */
export const clean = (value: string) => value.replaceAll('\u0000', '');

/** A string from GitHub with NUL removed */
export const text = z.string().transform(clean);
export const timestamp = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'not a date');
export const githubUser = z.object({
  id: z.number().int(),
  login: text.pipe(z.string().min(1)),
});

/** The sender of an event; one that cannot be read is nobody */
export const senderSchema = githubUser.nullable().catch(null);

/**
 * GitHub's link if it is an https one (it ends up in an href), else the one built from the repo.
 * @param url The link GitHub gave
 * @param fallback The link to use instead
 */
export function httpsOr(url: string, fallback: string): string {
  return /^https:\/\/[^\s]+$/i.test(url) ? url : fallback;
}

/**
 * Cuts a text to at most a number of bytes of UTF-8 without splitting a character, and drops NUL
 * characters, which the database refuses.
 * @param value The text
 * @param maxBytes The most bytes to keep
 */
export function cutUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(clean(value), 'utf8');
  if (bytes.length <= maxBytes) return bytes.toString('utf8');
  let end = maxBytes;
  // A continuation byte (10xxxxxx) at the cut means the character straddles it: leave it out
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8');
}

/** @param lists Lists of ids */
export const union = (...lists: string[][]) => [...new Set(lists.flat())];

/**
 * The project and the web address of a repository link.
 * @param repoLinkId The repository link
 */
export async function loadLink(repoLinkId: string) {
  return prisma.githubRepoLink.findUnique({
    where: { id: repoLinkId },
    select: { projectId: true, htmlUrl: true },
  });
}

/**
 * The part of an outcome every store shares: the actor is resolved here, before any transaction.
 * @param repoLinkId The repository link
 * @param link What `loadLink` found, null when the link is gone
 * @param sender Who did it on GitHub
 * @param source What brought the change in
 * @param meta The event behind the change
 * @param defaults The event and action to use when the meta names none
 * @param defaults.event
 * @param defaults.action
 */
export async function outcomeBase(
  repoLinkId: string,
  link: { projectId: string } | null,
  sender: Sender,
  source: GithubEventOutcome['source'],
  meta: OutcomeMeta,
  defaults: { event: string; action: string | null },
): Promise<Omit<GithubEventOutcome, 'transitions'>> {
  return {
    repoLinkId,
    projectId: link?.projectId ?? '',
    event: meta.event ?? defaults.event,
    action: meta.action === undefined ? defaults.action : meta.action,
    source,
    actor: await resolveGithubActor(sender),
    linkedIssueIds: [],
    removedIssueIds: [],
    drivingIssueIds: [],
    payload: meta.payload ?? {},
  };
}

/**
 * The first statement of every store transaction. Unlinking deletes the link row and its children
 * cascade, so a store takes the link before its own rows, in that order too, and never waits on a
 * lock the unlink holds the other way round.
 * @param tx The transaction
 * @param repoLinkId The repository link
 * @returns False when the link is gone: nothing is stored
 */
export async function lockLink(tx: StoreClient, repoLinkId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM github_repo_links WHERE id = ${repoLinkId} FOR KEY SHARE`;
  return rows.length > 0;
}

/**
 * Runs a store once more when two calls raced to create the same row and the other won; the
 * failed attempt rolled back whole, so the second one starts from what the winner stored.
 * @param run The store
 */
export async function retryOnRace<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return run();
  }
}

/**
 * The link of a delivery's repository as it is now (a link replaced since the delivery arrived is
 * the new link's business); null when the repository has none. Writes: it sets the link's
 * `lastDeliveryAt` to now.
 * @param d The delivery
 */
export async function touchLinkDelivery(d: GithubDeliveryContext) {
  if (d.repoId === null) return null;
  const link = await findRepoLinkByRepoId(d.repoId);
  if (!link) return null;
  await prisma.githubRepoLink.updateMany({
    where: { id: link.id },
    data: { lastDeliveryAt: new Date() },
  });
  return link;
}
