import { randomBytes } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../../config/database';
import { decryptSecret, encryptSecret, secretContext } from '../../lib/secret-box';
import { AppError } from '../../middleware/errorHandler';

import {
  githubPaginate,
  githubRequest,
  githubWebUrl,
  withoutGithubCallLimit,
} from './github-client';
import { githubIdJson, githubUnavailable, openGithubSecret } from './github-errors';

/** The App is one row, and its id is part of every context a secret of it is sealed with */
export const GITHUB_APP_ROW_ID = 1;
const SETUP_STATE_MINUTES = 10;
const MAX_OPEN_STATES = 5;
/** A cached installation token is replaced this long before GitHub says it expires */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
/** GitHub's login rule: 1 to 39 letters, digits and hyphens, not starting with a hyphen */
export const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

type SecretField = 'clientSecret' | 'privateKey' | 'webhookSecret';

/**
 * Seals a secret of the App row with the context it is opened with.
 * @param field Which secret of the row
 * @param plain The secret
 */
export const sealGithubAppSecret = (field: SecretField, plain: string) =>
  encryptSecret(plain, secretContext('githubApp', field, String(GITHUB_APP_ROW_ID)));
const sealed = sealGithubAppSecret;
const opened = (field: SecretField, stored: string) =>
  openGithubSecret(() =>
    decryptSecret(stored, secretContext('githubApp', field, String(GITHUB_APP_ROW_ID))),
  );

const appExists = () =>
  new AppError(
    409,
    'A GitHub App is already set up here. If you just created one, it may also exist on GitHub without being stored: delete it there under Settings, Developer settings, GitHub Apps',
    'GITHUB_APP_EXISTS',
  );

/** What `githubApp.status` answers: never a secret */
export type GithubAppStatus = {
  configured: boolean;
  slug?: string;
  htmlUrl?: string;
  installUrl?: string;
  /** `id` is a number, or a string in the (unseen) case that GitHub's id exceeds 2^53 - 1 */
  installations: Array<{
    id: number | string;
    accountLogin: string;
    suspended: boolean;
    /** Deleted on GitHub, or no longer listed by it */
    removed: boolean;
  }>;
};

/**
 * Where this instance is reached, as GitHub is told to redirect and call back.
 * @returns The origin of FRONTEND_URL (localhost:7000 in development)
 */
export function instanceOrigin(): string {
  try {
    return new URL(process.env.FRONTEND_URL || 'http://localhost:7000').origin;
  } catch {
    return 'http://localhost:7000';
  }
}

/** GitHub limits an App's name to 34 characters */
const APP_NAME_MAX = 34;

/**
 * The App's name, with the host shortened until the name fits GitHub's limit. The admin can
 * rename it on GitHub's form.
 * @param host The host of this instance
 */
function appName(host: string): string {
  const room = APP_NAME_MAX - 'Axiom ()'.length;
  return `Axiom (${host.slice(0, room)})`;
}

/**
 * The manifest GitHub turns into an App.
 * @param origin The origin of this instance, from FRONTEND_URL
 */
export function appManifest(origin: string): Record<string, unknown> {
  return {
    name: appName(new URL(origin).host),
    url: origin,
    hook_attributes: { url: `${origin}/api/github/webhook` },
    redirect_url: `${origin}/admin/github/created`,
    callback_urls: [`${origin}/settings/github/callback`],
    setup_url: `${origin}/admin/github/installed`,
    public: false,
    request_oauth_on_install: false,
    default_permissions: {
      metadata: 'read',
      contents: 'write',
      pull_requests: 'write',
      checks: 'write',
      actions: 'write',
      issues: 'write',
      statuses: 'read',
    },
    default_events: [
      'pull_request',
      'pull_request_review',
      'check_run',
      'check_suite',
      'workflow_job',
      'push',
      'create',
      'delete',
      'issues',
      'issue_comment',
    ],
  };
}

/**
 * The App's secrets, decrypted. Server only: no action returns this.
 * @returns The App, or null when none is set up
 */
export async function getGithubAppSecrets(): Promise<{
  appId: number;
  slug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  webhookSecret: string;
} | null> {
  const row = await prisma.githubApp.findUnique({ where: { id: GITHUB_APP_ROW_ID } });
  if (!row) return null;
  return {
    appId: Number(row.appId),
    slug: row.slug,
    clientId: row.clientId,
    clientSecret: opened('clientSecret', row.clientSecret),
    privateKey: opened('privateKey', row.privateKey),
    webhookSecret: opened('webhookSecret', row.webhookSecret),
  };
}

// ---- Credentials for the client (registered in github-resolvers.ts)

// A token belongs to the App that minted it. The generation (appId and when the row was made)
// is read from the database on every resolve, so a token of a forgotten or replaced App is
// dropped by every process, not only the one that handled the delete.
const installationTokens = new Map<number, { gen: string; token: string; expiresAt: number }>();
const installationFetches = new Map<string, Promise<string>>();
// Bumped by every clear: a fetch that started before one never writes to the cache
let cacheEpoch = 0;

const tokenReply = z.object({ token: z.string().min(1), expires_at: z.string() });

/**
 * A token for one installation: the cached one until 5 minutes before it expires, else a new
 * one. Calls made at the same time share one request.
 * @param installationId GitHub's installation id
 */
export async function installationToken(installationId: number): Promise<string> {
  const current = await prisma.githubApp.findUnique({
    where: { id: GITHUB_APP_ROW_ID },
    select: { appId: true, createdAt: true },
  });
  if (!current) {
    installationTokens.delete(installationId);
    throw new AppError(409, 'No GitHub App is set up', 'GITHUB_APP_MISSING');
  }
  const gen = `${current.appId}:${current.createdAt.getTime()}`;
  const cached = installationTokens.get(installationId);
  if (cached && cached.gen === gen && Date.now() < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return cached.token;
  }
  const key = `${gen}/${installationId}`;
  const running = installationFetches.get(key);
  if (running) return running;
  const epoch = cacheEpoch;
  const fetching = (async () => {
    // Other callers wait on this fetch: the limit of the run that started it must not refuse it
    const { data } = await withoutGithubCallLimit(() =>
      githubRequest<unknown>(
        { kind: 'app' },
        'POST',
        `/app/installations/${installationId}/access_tokens`,
      ),
    );
    const parsed = tokenReply.safeParse(data);
    const expiresAt = parsed.success ? Date.parse(parsed.data.expires_at) : Number.NaN;
    if (!parsed.success || Number.isNaN(expiresAt)) throw githubUnavailable('unreadable');
    if (epoch === cacheEpoch) {
      installationTokens.set(installationId, { gen, token: parsed.data.token, expiresAt });
    }
    return parsed.data.token;
  })().finally(() => {
    if (installationFetches.get(key) === fetching) installationFetches.delete(key);
  });
  installationFetches.set(key, fetching);
  return fetching;
}

/**
 * A new token for an installation whose token GitHub refused (revoked early, say). The cached
 * token is dropped only if it is the refused one: a call refused together with another finds the
 * new token the first one fetched, and calls made at the same time share one request.
 * @param installationId GitHub's installation id
 * @param refused The token GitHub refused
 */
export async function renewInstallationToken(
  installationId: number,
  refused: string,
): Promise<string> {
  if (installationTokens.get(installationId)?.token === refused) {
    installationTokens.delete(installationId);
  }
  return installationToken(installationId);
}

/**
 * Which App row exists: its id and when it was made. A different value later means the App was
 * forgotten or replaced in between.
 * @returns The generation, or null when no App is set up
 */
export async function githubAppGeneration(): Promise<string | null> {
  const row = await prisma.githubApp.findUnique({
    where: { id: GITHUB_APP_ROW_ID },
    select: { appId: true, createdAt: true },
  });
  return row ? `${row.appId}:${row.createdAt.getTime()}` : null;
}

/** Forgets every cached installation token and every fetch in flight (the App changed) */
export function clearInstallationTokens(): void {
  cacheEpoch += 1;
  installationTokens.clear();
  installationFetches.clear();
}

// ---- Status

/** The App and its installations, as `githubApp.status` answers. */
export async function getStatus(): Promise<GithubAppStatus> {
  const [app, installations] = await Promise.all([
    prisma.githubApp.findUnique({ where: { id: GITHUB_APP_ROW_ID } }),
    prisma.githubInstallation.findMany({ orderBy: { id: 'asc' } }),
  ]);
  if (!app) return { configured: false, installations: [] };
  return {
    configured: true,
    slug: app.slug,
    htmlUrl: app.htmlUrl,
    installUrl: `${app.htmlUrl.replace(/\/+$/, '')}/installations/new`,
    installations: installations.map((i) => ({
      id: githubIdJson(i.id),
      accountLogin: i.accountLogin,
      suspended: i.suspendedAt !== null,
      removed: i.removedAt !== null,
    })),
  };
}

// ---- Manifest flow

/**
 * Starts the manifest flow: one single-use state, good for 10 minutes, and the page that
 * GitHub's form is posted to.
 * @param userId The admin starting it
 * @param organization A GitHub organization to own the App, else the admin's own account
 */
export async function startManifest(userId: string, organization?: string) {
  if (organization !== undefined && !GITHUB_LOGIN_PATTERN.test(organization)) {
    throw new AppError(400, 'That is not a GitHub organization name', 'VALIDATION_ERROR');
  }
  // GitHub is told to call this origin back: localhost, or plain http, would make an App that
  // can never reach this instance, and only deleting it on GitHub repairs that
  if (process.env.NODE_ENV === 'production') {
    let secure = false;
    try {
      secure = new URL(process.env.FRONTEND_URL ?? '').protocol === 'https:';
    } catch {
      // Unset or not a URL
    }
    if (!secure) {
      throw new AppError(
        409,
        'FRONTEND_URL must be set to the public https address of this instance before the GitHub App is created, because GitHub is told to call back there. Set it in .env and restart the API',
        'GITHUB_FRONTEND_URL_REQUIRED',
      );
    }
  }
  if (await prisma.githubApp.findUnique({ where: { id: GITHUB_APP_ROW_ID } })) {
    throw appExists();
  }
  const now = new Date();
  await prisma.githubSetupState.deleteMany({ where: { expiresAt: { lte: now } } });
  // At most 5 open states per person: the oldest goes
  const open = await prisma.githubSetupState.findMany({
    where: { userId },
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
      purpose: 'manifest',
      expiresAt: new Date(now.getTime() + SETUP_STATE_MINUTES * 60_000),
    },
  });
  const page = organization
    ? `/organizations/${organization}/settings/apps/new`
    : '/settings/apps/new';
  return {
    postUrl: `${githubWebUrl(page)}?state=${encodeURIComponent(state)}`,
    manifest: appManifest(instanceOrigin()),
    state,
  };
}

const conversionReply = z.object({
  id: z.number().int(),
  slug: z.string().min(1),
  name: z.string().min(1),
  html_url: z.string().min(1),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  // GitHub documents it as nullable; the manifest always asks for a webhook, so none is an error
  webhook_secret: z.string().nullish(),
  pem: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
});

/**
 * Finishes the manifest flow. The state is deleted in one statement that also checks the
 * user and the expiry, so two calls at once cannot both pass.
 * @param userId The admin finishing it
 * @param code The one-time code GitHub put on the redirect
 * @param state The state startManifest gave
 */
export async function completeManifest(userId: string, code: string, state: string) {
  const { count } = await prisma.githubSetupState.deleteMany({
    where: { state, userId, purpose: 'manifest', expiresAt: { gt: new Date() } },
  });
  if (count !== 1) {
    throw new AppError(
      400,
      'This setup link is invalid or has expired: start again',
      'INVALID_STATE',
    );
  }
  if (await prisma.githubApp.findUnique({ where: { id: GITHUB_APP_ROW_ID } })) {
    throw appExists();
  }
  const { data } = await githubRequest<unknown>(
    { kind: 'none' },
    'POST',
    `/app-manifests/${encodeURIComponent(code)}/conversions`,
  );
  const app = conversionReply.safeParse(data);
  // The reply holds the secrets, so nothing of it goes into an error
  if (!app.success) throw githubUnavailable('unreadable');
  if (!app.data.webhook_secret) {
    throw new AppError(
      502,
      'GitHub created the App without a webhook secret, so it was not stored. Delete the App on GitHub (Settings, Developer settings, GitHub Apps) and start again',
      'GITHUB_APP_INCOMPLETE',
    );
  }
  try {
    await prisma.githubApp.create({
      data: {
        id: GITHUB_APP_ROW_ID,
        appId: app.data.id,
        slug: app.data.slug,
        name: app.data.name,
        htmlUrl: app.data.html_url,
        ownerLogin: app.data.owner.login,
        clientId: app.data.client_id,
        clientSecret: sealed('clientSecret', app.data.client_secret),
        privateKey: sealed('privateKey', app.data.pem),
        webhookSecret: sealed('webhookSecret', app.data.webhook_secret),
        createdById: userId,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw appExists();
    }
    throw err;
  }
  clearInstallationTokens();
  return getStatus();
}

// ---- Installations

const installationList = z.array(
  z.object({
    id: z.number().int(),
    account: z.object({ login: z.string().min(1), type: z.string().min(1) }),
    suspended_at: z.string().nullish(),
  }),
);

/**
 * Reads the App's installations from GitHub into the table. One that GitHub no longer lists is
 * marked suspended, but only when the list was read to its end.
 */
export async function syncInstallations(): Promise<GithubAppStatus> {
  if (!(await prisma.githubApp.findUnique({ where: { id: GITHUB_APP_ROW_ID } }))) {
    throw new AppError(409, 'No GitHub App is set up', 'GITHUB_APP_MISSING');
  }
  const { items, complete } = await githubPaginate<unknown>({ kind: 'app' }, '/app/installations', {
    maxPages: 10,
  });
  const parsed = installationList.safeParse(items);
  if (!parsed.success) throw githubUnavailable('unreadable');
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const item of parsed.data) {
      const suspendedAt = item.suspended_at ? new Date(item.suspended_at) : null;
      await tx.githubInstallation.upsert({
        where: { id: item.id },
        create: {
          id: item.id,
          accountLogin: item.account.login,
          accountType: item.account.type,
          suspendedAt,
          lastEventAt: now,
        },
        update: {
          accountLogin: item.account.login,
          accountType: item.account.type,
          suspendedAt,
          removedAt: null,
          lastEventAt: now,
        },
      });
    }
    if (complete) {
      await tx.githubInstallation.updateMany({
        where: { id: { notIn: parsed.data.map((i) => i.id) }, removedAt: null },
        data: { removedAt: now, lastEventAt: now },
      });
    }
  });
  return getStatus();
}

// ---- Removal

/**
 * Forgets the App, its installations, the connected accounts and the tokens cached for them. GitHub is not asked to
 * delete anything.
 */
export async function deleteApp() {
  const { count } = await prisma.$transaction(async (tx) => {
    await tx.githubInstallation.deleteMany();
    // Their tokens belong to this App: no other App can refresh them
    await tx.githubAccount.deleteMany();
    await tx.githubSetupState.deleteMany();
    // Deliveries of this App that are still open would write its installations back
    await tx.githubDelivery.updateMany({
      where: { status: { in: ['PENDING', 'FAILED'] } },
      data: {
        status: 'IGNORED',
        nextAttemptAt: null,
        error: 'App forgotten',
        processedAt: new Date(),
      },
    });
    return tx.githubApp.deleteMany({ where: { id: GITHUB_APP_ROW_ID } });
  });
  if (count === 0) throw new AppError(404, 'No GitHub App is set up', 'NOT_FOUND');
  clearInstallationTokens();
  return {
    deleted: true,
    note: 'The App is forgotten here only. It still exists on GitHub: delete it there under Settings, Developer settings, GitHub Apps.',
  };
}
