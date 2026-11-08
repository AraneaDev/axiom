import type { UserKind } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

// A user's kind never changes, so a lookup holds for the life of the process. Only found users are
// kept: an id that does not exist yet answers undefined and is asked again next time.
const kinds = new Map<string, UserKind>();

/**
 * A user's kind, cached.
 * @param userId - The user
 * @returns The kind, or undefined for a user that does not exist
 */
async function kindOf(userId: string): Promise<UserKind | undefined> {
  const known = kinds.get(userId);
  if (known !== undefined) return known;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { kind: true } });
  if (!user) return undefined;
  kinds.set(userId, user.kind);
  return user.kind;
}

/**
 * Whether a user is a person: `kind = PERSON`. The GitHub integration user and service accounts
 * (bots) are not, and are never assigned, notified, mentioned, made a watcher or added by invite.
 * For a synchronous check on a hot path that only needs the integration user, use
 * `isIntegrationUser`.
 * @param userId - The user to test
 * @returns true only for an existing user of kind PERSON
 */
export async function isPerson(userId: string): Promise<boolean> {
  return (await kindOf(userId)) === 'PERSON';
}

/**
 * Whether a user is a service account (a bot): `kind = SERVICE`. Not the same as "not a person":
 * the GitHub integration user is neither.
 * @param userId - The user to test
 * @returns true only for an existing user of kind SERVICE
 */
export async function isServiceAccount(userId: string): Promise<boolean> {
  return (await kindOf(userId)) === 'SERVICE';
}

/**
 * Refuse a user who is not a person as the target of an assignment, a notification, a watch or a
 * membership by invite. A bot as the actor is never refused here.
 * @param userId - The proposed target
 * @param code - The error code of the refusal
 * @param message - The error message of the refusal
 * @throws {AppError} 400 when the target is not a person
 */
export async function assertPersonTarget(
  userId: string,
  code: string,
  message: string,
): Promise<void> {
  if (!(await isPerson(userId))) throw new AppError(400, message, code);
}
