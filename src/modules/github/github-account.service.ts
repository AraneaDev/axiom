import { randomBytes } from 'node:crypto';

import { createId } from '@paralleldrive/cuid2';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../../config/database';
import { decryptSecret, encryptSecret, secretContext } from '../../lib/secret-box';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';

import { getGithubAppSecrets, instanceOrigin } from './github-app.service';
import { githubRequest, githubWebPost, githubWebUrl } from './github-client';
import { githubUnavailable } from './github-errors';

const STORE_ATTEMPTS = 3;
const STATE_MINUTES = 10;
const MAX_OPEN_STATES = 5;
/** A token is refreshed once it expires within this long */
const REFRESH_MARGIN_MS = 5 * 60_000;
/** The refresh call itself is short; the transaction around it has room for it and the queries */
const REFRESH_HTTP_TIMEOUT_MS = 8_000;
const REFRESH_TX_TIMEOUT_MS = 15_000;
const REFRESH_TX_MAX_WAIT_MS = 5_000;
/** What stays of the transaction after the GitHub call: to write the answer and commit */
const REFRESH_MARGIN_LEFT_MS = 2_000;
const REFRESH_MIN_HTTP_MS = 1_000;

const RECONNECT_MESSAGE = 'Your GitHub connection expired. Connect GitHub again in Settings.';
const reconnect = () => new AppError(409, RECONNECT_MESSAGE, 'GITHUB_RECONNECT');

type TokenField = 'accessToken' | 'refreshToken';
const seal = (field: TokenField, id: string, plain: string) =>
  encryptSecret(plain, secretContext('githubAccount', field, id));
const open = (field: TokenField, id: string, stored: string) =>
  decryptSecret(stored, secretContext('githubAccount', field, id));

/** The part of a Prisma client the refresh needs: a transaction on one connection */
type TransactionRunner = {
  $transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
};

/** What `githubAccount.get` and the other actions answer: never a token */
export type GithubAccountStatus = { connected: boolean; login?: string; githubUserId?: number };

// ---- Credentials for the client (registered in github-resolvers.ts)

type AccountTokens = {
  id: string;
  accessToken: string;
  accessTokenExpiresAt: Date | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
};

const needsRefresh = (row: AccountTokens) =>
  row.accessTokenExpiresAt !== null &&
  row.accessTokenExpiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;

/**
 * The access token of a user's account: the stored one, or a refreshed one when it expires
 * within 5 minutes.
 * @param userId The Axiom user
 */
export async function userToken(userId: string): Promise<string> {
  const row = await prisma.githubAccount.findUnique({ where: { userId } });
  if (!row) throw notConnected();
  return needsRefresh(row)
    ? refreshUserToken(userId)
    : open('accessToken', row.id, row.accessToken);
}

const notConnected = () =>
  new AppError(409, 'Connect your GitHub account in Settings first', 'GITHUB_NOT_CONNECTED');

const tokenReply = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().positive().optional(),
});
const oauthError = z.object({ error: z.string() });

/**
 * Turns an answer of GitHub's token endpoint into tokens. Nothing of the answer goes into an
 * error: it holds tokens, and its `error` text is GitHub's.
 * @param status GitHub's status
 * @param data The parsed body
 */
function readTokenReply(status: number, data: unknown) {
  const parsed = tokenReply.safeParse(data);
  if (status === 200 && parsed.success) {
    const now = Date.now();
    return {
      accessToken: parsed.data.access_token,
      accessTokenExpiresAt: parsed.data.expires_in
        ? new Date(now + parsed.data.expires_in * 1000)
        : null,
      refreshToken: parsed.data.refresh_token ?? null,
      refreshTokenExpiresAt:
        parsed.data.refresh_token && parsed.data.refresh_token_expires_in
          ? new Date(now + parsed.data.refresh_token_expires_in * 1000)
          : null,
    };
  }
  const failure = oauthError.safeParse(data);
  throw failure.success
    ? new GithubOauthRefusal(failure.data.error)
    : status === 200
      ? githubUnavailable('unreadable')
      : new AppError(502, `GitHub answered with status ${status}.`, 'GITHUB_UNAVAILABLE');
}

/** GitHub's token endpoint refused with an `error`: what that means is for the caller to decide */
class GithubOauthRefusal extends Error {
  constructor(readonly reason: string) {
    super('GitHub refused the token request');
  }
}

/** What the App's own credentials being refused means for whoever asked */
const appAuthRefused = () =>
  new AppError(
    502,
    'GitHub refused the credentials of the GitHub App. Check the App in the admin settings.',
    'GITHUB_APP_AUTH',
  );

/** How the refresh is run: tests narrow the budget, the GitHub call passes the token it was refused */
type RefreshOptions = {
  /** The access token GitHub refused: if the row holds another one, someone renewed it already */
  rejected?: string;
  /** The time the whole transaction may take (default 15 s) */
  budgetMs?: number;
};

/**
 * Refreshes a user's access token, once however many processes ask: the work runs in a
 * transaction that holds an advisory lock for the user, and the row is read again after taking
 * it, so a process that waited finds the new token and skips the call. A refresh token that
 * GitHub refuses ends the connection. The write is conditional on the token that was read, so
 * a reconnect or a disconnect during the GitHub call is not overwritten: the rotated token is
 * revoked instead.
 * @param userId The Axiom user
 * @param db The Prisma client to run on. Another process has another connection, so tests pass a
 *   second client to stand in for it
 * @param opts `rejected` forces a refresh of a token GitHub refused; `budgetMs` is the time the
 *   transaction may take
 * @returns The access token to use
 * @throws {AppError} 409 GITHUB_RECONNECT, 409 GITHUB_NOT_CONNECTED, 503 when too little of the
 *   transaction is left to call GitHub, 502 when GitHub fails
 */
export async function refreshUserToken(
  userId: string,
  db: TransactionRunner = prisma,
  opts: RefreshOptions = {},
): Promise<string> {
  const budget = opts.budgetMs ?? REFRESH_TX_TIMEOUT_MS;
  const deadline = Date.now() + budget;
  const outcome = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('github-refresh:' || ${userId}::text))`;
      const row = await tx.githubAccount.findUnique({ where: { userId } });
      if (!row) throw notConnected();
      const current = open('accessToken', row.id, row.accessToken);
      const forced = opts.rejected !== undefined && current === opts.rejected;
      if (!forced && !needsRefresh(row)) return { token: current };

      const now = Date.now();
      const canRefresh =
        row.refreshToken !== null &&
        (row.refreshTokenExpiresAt === null || row.refreshTokenExpiresAt.getTime() > now);
      if (!canRefresh) {
        // Still valid for a few minutes: use it. Else nothing can renew it.
        if (!forced && row.accessTokenExpiresAt!.getTime() > now) return { token: current };
        await tx.githubAccount.delete({ where: { id: row.id } });
        return { gone: true as const };
      }

      // The GitHub call must end inside the transaction, with room to write: a rotated token
      // the transaction cannot store is lost
      const httpTimeout = Math.min(
        REFRESH_HTTP_TIMEOUT_MS,
        deadline - now - REFRESH_MARGIN_LEFT_MS,
      );
      if (httpTimeout < REFRESH_MIN_HTTP_MS) {
        throw new AppError(503, 'GitHub is busy. Try again in a moment.', 'GITHUB_BUSY');
      }
      const app = await getGithubAppSecrets();
      if (!app) throw new AppError(409, 'No GitHub App is set up', 'GITHUB_APP_MISSING');
      const { status, data } = await githubWebPost(
        '/login/oauth/access_token',
        {
          client_id: app.clientId,
          client_secret: app.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: open('refreshToken', row.id, row.refreshToken!),
        },
        httpTimeout,
      );
      let fresh: ReturnType<typeof readTokenReply>;
      try {
        if (status === 401) throw new GithubOauthRefusal('bad_refresh_token');
        fresh = readTokenReply(status, data);
      } catch (err) {
        if (!(err instanceof GithubOauthRefusal)) throw err;
        if (err.reason !== 'bad_refresh_token') throw appAuthRefused();
        await tx.githubAccount.delete({ where: { id: row.id } });
        return { gone: true as const };
      }
      // Only the row as it was read is updated: a reconnect or a disconnect since then wins
      const { count } = await tx.githubAccount.updateMany({
        where: { id: row.id, accessToken: row.accessToken },
        data: {
          accessToken: seal('accessToken', row.id, fresh.accessToken),
          accessTokenExpiresAt: fresh.accessTokenExpiresAt,
          refreshToken: fresh.refreshToken
            ? seal('refreshToken', row.id, fresh.refreshToken)
            : null,
          refreshTokenExpiresAt: fresh.refreshTokenExpiresAt,
        },
      });
      return count === 1 ? { token: fresh.accessToken } : { superseded: fresh.accessToken };
    },
    { timeout: budget, maxWait: REFRESH_TX_MAX_WAIT_MS },
  );
  // Thrown after the commit, so the deletion stands
  if ('gone' in outcome) throw reconnect();
  if ('superseded' in outcome) {
    // What GitHub just rotated is nobody's: revoke it and use the connection that replaced it
    const app = await prisma.githubApp.findFirst({ select: { clientId: true } });
    if (app) await revokeToken(app.clientId, (outcome as { superseded: string }).superseded);
    return userToken(userId);
  }
  return outcome.token;
}

// ---- Status

/**
 * Whether a user has connected GitHub, and as whom.
 * @param userId The Axiom user
 */
export async function getAccount(userId: string): Promise<GithubAccountStatus> {
  const row = await prisma.githubAccount.findUnique({
    where: { userId },
    select: { login: true, githubUserId: true },
  });
  return row
    ? { connected: true, login: row.login, githubUserId: row.githubUserId }
    : { connected: false };
}

// ---- Connecting

/**
 * Starts the connection: one single-use state, good for 10 minutes, and the GitHub page to send
 * the person to.
 * @param userId The person connecting
 */
export async function startConnect(userId: string): Promise<{ authorizeUrl: string }> {
  const appRow = await prisma.githubApp.findFirst({ select: { clientId: true } });
  if (!appRow) throw new AppError(409, 'No GitHub App is set up', 'GITHUB_APP_MISSING');
  const now = new Date();
  await prisma.githubSetupState.deleteMany({ where: { expiresAt: { lte: now } } });
  // At most 5 open states per person: the oldest goes
  const open = await prisma.githubSetupState.findMany({
    where: { userId, purpose: 'user' },
    orderBy: { expiresAt: 'asc' },
    select: { state: true },
  });
  if (open.length >= MAX_OPEN_STATES) {
    await prisma.githubSetupState.deleteMany({
      where: {
        state: { in: open.slice(0, open.length - MAX_OPEN_STATES + 1).map((o) => o.state) },
      },
    });
  }
  const state = randomBytes(24).toString('base64url');
  await prisma.githubSetupState.create({
    data: {
      state,
      userId,
      purpose: 'user',
      expiresAt: new Date(now.getTime() + STATE_MINUTES * 60_000),
    },
  });
  const query = new URLSearchParams({
    client_id: appRow.clientId,
    state,
    redirect_uri: redirectUri(),
  });
  return { authorizeUrl: `${githubWebUrl('/login/oauth/authorize')}?${query}` };
}

const redirectUri = () => `${instanceOrigin()}/settings/github/callback`;

const githubUserReply = z.object({ id: z.number().int(), login: z.string().min(1) });

/**
 * Best effort: asks GitHub to revoke a token. A failure is logged without the token (nor
 * GitHub's words, which may echo it) and changes nothing for the caller.
 * @param clientId The App's client id
 * @param accessToken The token to revoke
 * @param what
 */
async function revokeToken(
  clientId: string,
  accessToken: string,
  what: 'token' | 'grant' = 'token',
): Promise<void> {
  try {
    await githubRequest(
      { kind: 'oauth-app' },
      'DELETE',
      `/applications/${encodeURIComponent(clientId)}/${what}`,
      { body: { access_token: accessToken } },
    );
  } catch (err) {
    logger.warn('github token revoke failed', {
      status: err instanceof AppError ? err.statusCode : undefined,
      code: err instanceof AppError ? err.code : undefined,
    });
  }
}

const accountTaken = () =>
  new AppError(
    409,
    'That GitHub account is already connected to another user',
    'GITHUB_ACCOUNT_TAKEN',
  );

/**
 * Finishes the connection. The state is deleted in one statement that also checks the user,
 * the purpose and the expiry, so two calls at once cannot both pass.
 * @param userId The person connecting
 * @param code The code GitHub put on the redirect
 * @param state The state startConnect gave
 */
export async function completeConnect(
  userId: string,
  code: string,
  state: string,
): Promise<GithubAccountStatus> {
  const { count } = await prisma.githubSetupState.deleteMany({
    where: { state, userId, purpose: 'user', expiresAt: { gt: new Date() } },
  });
  if (count !== 1) {
    throw new AppError(
      400,
      'This connection link is invalid or has expired: start again',
      'INVALID_STATE',
    );
  }
  const app = await getGithubAppSecrets();
  if (!app) throw new AppError(409, 'No GitHub App is set up', 'GITHUB_APP_MISSING');

  const { status, data } = await githubWebPost('/login/oauth/access_token', {
    client_id: app.clientId,
    client_secret: app.clientSecret,
    code,
    redirect_uri: redirectUri(),
  });
  let tokens: ReturnType<typeof readTokenReply>;
  try {
    tokens = readTokenReply(status, data);
  } catch (err) {
    if (!(err instanceof GithubOauthRefusal)) throw err;
    if (err.reason === 'incorrect_client_credentials') throw appAuthRefused();
    throw new AppError(
      400,
      'GitHub did not accept the sign-in: connect again',
      'GITHUB_OAUTH_REJECTED',
    );
  }

  // From here the new token is GitHub's to forget if it is not kept
  const me = githubUserReply.safeParse(
    await githubRequest<unknown>({ kind: 'token', token: tokens.accessToken }, 'GET', '/user')
      .then((r) => r.data)
      .catch(async (err: unknown) => {
        await revokeToken(app.clientId, tokens.accessToken);
        throw err;
      }),
  );
  if (!me.success) {
    await revokeToken(app.clientId, tokens.accessToken);
    throw githubUnavailable('unreadable');
  }

  const holder = await prisma.githubAccount.findUnique({
    where: { githubUserId: me.data.id },
    select: { userId: true },
  });
  if (holder && holder.userId !== userId) {
    await revokeToken(app.clientId, tokens.accessToken);
    throw accountTaken();
  }

  // The row id is part of the context the tokens are sealed with, so a row that exists keeps its
  // id and is updated; there is no upsert, which could update a row made a moment ago under an
  // id the tokens were not sealed for. A row made or removed by another call in between is met
  // by reading again: the later connect wins.
  for (let attempt = 0; attempt < STORE_ATTEMPTS; attempt++) {
    const existing = await prisma.githubAccount.findUnique({
      where: { userId },
      select: { id: true, accessToken: true },
    });
    const id = existing?.id ?? createId();
    const sealed = {
      githubUserId: me.data.id,
      login: me.data.login,
      accessToken: seal('accessToken', id, tokens.accessToken),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshToken: tokens.refreshToken ? seal('refreshToken', id, tokens.refreshToken) : null,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
      connectedAt: new Date(),
    };
    try {
      if (existing) {
        const { count } = await prisma.githubAccount.updateMany({
          where: { id, userId },
          data: sealed,
        });
        if (count === 0) continue;
        // A connection that replaces another one lets go of the old token
        try {
          await revokeToken(app.clientId, open('accessToken', id, existing.accessToken));
        } catch {
          // An old token that does not open is nothing to revoke: the new one is stored
        }
      } else {
        await prisma.githubAccount.create({ data: { id, userId, ...sealed } });
      }
      return { connected: true, login: me.data.login, githubUserId: me.data.id };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      // Taken by another user's connection, or by this user's other tab: only the first is a refusal
      const taken = await prisma.githubAccount.findUnique({
        where: { githubUserId: me.data.id },
        select: { userId: true },
      });
      if (taken && taken.userId !== userId) {
        await revokeToken(app.clientId, tokens.accessToken);
        throw accountTaken();
      }
    }
  }
  await revokeToken(app.clientId, tokens.accessToken);
  throw new AppError(
    409,
    'Another connection to GitHub is being made right now: try again',
    'GITHUB_CONNECT_IN_PROGRESS',
  );
}

/**
 * Removes the connection and asks GitHub to revoke the person's whole grant of the App, so the
 * refresh token dies with the access token. The row goes first: a revoke that fails does not
 * keep it.
 * @param userId The person disconnecting
 */
export async function disconnect(userId: string): Promise<GithubAccountStatus> {
  const row = await prisma.githubAccount.findUnique({ where: { userId } });
  if (!row) return { connected: false };
  const { count } = await prisma.githubAccount.deleteMany({ where: { id: row.id } });
  if (count === 1) {
    const app = await prisma.githubApp.findFirst({ select: { clientId: true } });
    if (app) await revokeToken(app.clientId, open('accessToken', row.id, row.accessToken), 'grant');
  }
  return { connected: false };
}
