import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

// A user's kind never changes, so a lookup holds for the life of the process. Only found users are
// kept: an id that does not exist yet answers false and is asked again next time.
const kinds = new Map<string, boolean>();

/**
 * Whether a user is a person: `kind = PERSON`. The GitHub integration user and service accounts
 * (bots) are not, and are never assigned, notified, mentioned, made a watcher or added by invite.
 * For a synchronous check on a hot path that only needs the integration user, use
 * `isIntegrationUser`.
 * @param userId - The user to test
 * @returns true only for an existing user of kind PERSON
 */
export async function isPerson(userId: string): Promise<boolean> {
  const known = kinds.get(userId);
  if (known !== undefined) return known;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { kind: true } });
  if (!user) return false;
  const person = user.kind === 'PERSON';
  kinds.set(userId, person);
  return person;
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
