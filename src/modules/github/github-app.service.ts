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
  registerGithubAuthResolver,
} from './github-client';
import { githubUnavailable } from './github-errors';
import { appJwt } from './github-jwt';

/** The App is one row, and its id is part of every context a secret of it is sealed with */
export const GITHUB_APP_ROW_ID = 1;
const SETUP_STATE_MINUTES = 10;
/** A cached installation token is replaced this long before GitHub says it expires */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
/** GitHub's login rule: 1 to 39 letters, digits and hyphens, not starting with a hyphen */
export const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

type SecretField = 'clientSecret' | 'privateKey' | 'webhookSecret';

const sealed = (field: SecretField, plain: string) =>
  encryptSecret(plain, secretContext('githubApp', field, String(GITHUB_APP_ROW_ID)));
const opened = (field: SecretField, stored: string) =>
  decryptSecret(stored, secretContext('githubApp', field, String(GITHUB_APP_ROW_ID)));

/** What `githubApp.status` answers: never a secret */
export type GithubAppStatus = {
  configured: boolean;
  slug?: string;
  htmlUrl?: string;
  installUrl?: string;
  installations: Array<{ id: number; accountLogin: string; suspended: boolean }>;
};

/**
 * Where this instance is reached, as GitHub is told to redirect and call back.
 * @returns The origin of FRONTEND_URL (localhost:7000 in development)
 */
function instanceOrigin(): string {
  try {
    return new URL(process.env.FRONTEND_URL || 'http://localhost:7000').origin;
  } catch {
    return 'http://localhost:7000';
  }
}

/**
 * The manifest GitHub turns into an App.
 * @param origin The origin of this instance, from FRONTEND_URL
 */
export function appManifest(origin: string): Record<string, unknown> {
  return {
    name: `Axiom (${new URL(origin).host})`,
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
      checks: 'read',
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
    appId: row.appId,
    slug: row.slug,
    clientId: row.clientId,
    clientSecret: opened('clientSecret', row.clientSecret),
    privateKey: opened('privateKey', row.privateKey),
    webhookSecret: opened('webhookSecret', row.webhookSecret),
  };
}

// ---- Credentials for the client

const installationTokens = new Map<number, { token: string; expiresAt: number }>();
const installationFetches = new Map<number, Promise<string>>();

const tokenReply = z.object({ token: z.string().min(1), expires_at: z.string() });

/**
 * A token for one installation: the cached one until 5 minutes before it expires, else a new
 * one. Calls made at the same time share one request.
 * @param installationId GitHub's installation id
 */
async function installationToken(installationId: number): Promise<string> {
  const cached = installationTokens.get(installationId);
  if (cached && Date.now() < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) return cached.token;
  const running = installationFetches.get(installationId);
  if (running) return running;
  const fetching = (async () => {
    const { data } = await githubRequest<unknown>(
      { kind: 'app' },
      'POST',
      `/app/installations/${installationId}/access_tokens`,
    );
    const parsed = tokenReply.safeParse(data);
    const expiresAt = parsed.success ? Date.parse(parsed.data.expires_at) : Number.NaN;
    if (!parsed.success || Number.isNaN(expiresAt)) throw githubUnavailable('unreadable');
    installationTokens.set(installationId, { token: parsed.data.token, expiresAt });
    return parsed.data.token;
  })().finally(() => installationFetches.delete(installationId));
  installationFetches.set(installationId, fetching);
  return fetching;
}

/** Forgets every cached installation token (the App was removed) */
export function clearInstallationTokens(): void {
  installationTokens.clear();
}

registerGithubAuthResolver('app', async () => {
  const app = await getGithubAppSecrets();
  if (!app) throw new AppError(409, 'No GitHub App is set up', 'GITHUB_APP_MISSING');
  return `Bearer ${appJwt(app.appId, app.privateKey)}`;
});

registerGithubAuthResolver('installation', async (auth) => {
  if (auth.kind !== 'installation') throw new Error('Not an installation');
  return `token ${await installationToken(auth.installationId)}`;
});

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
      id: i.id,
      accountLogin: i.accountLogin,
      suspended: i.suspendedAt !== null,
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
  if (await prisma.githubApp.findUnique({ where: { id: GITHUB_APP_ROW_ID } })) {
    throw new AppError(409, 'A GitHub App is already set up', 'GITHUB_APP_EXISTS');
  }
  const now = new Date();
  await prisma.githubSetupState.deleteMany({ where: { expiresAt: { lte: now } } });
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
  webhook_secret: z.string().min(1),
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
    throw new AppError(409, 'A GitHub App is already set up', 'GITHUB_APP_EXISTS');
  }
  const { data } = await githubRequest<unknown>(
    { kind: 'none' },
    'POST',
    `/app-manifests/${encodeURIComponent(code)}/conversions`,
  );
  const app = conversionReply.safeParse(data);
  // The reply holds the secrets, so nothing of it goes into an error
  if (!app.success) throw githubUnavailable('unreadable');
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
      throw new AppError(409, 'A GitHub App is already set up', 'GITHUB_APP_EXISTS');
    }
    throw err;
  }
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
        },
        update: { accountLogin: item.account.login, accountType: item.account.type, suspendedAt },
      });
    }
    if (complete) {
      await tx.githubInstallation.updateMany({
        where: { id: { notIn: parsed.data.map((i) => i.id) }, suspendedAt: null },
        data: { suspendedAt: now },
      });
    }
  });
  return getStatus();
}

// ---- Removal

/**
 * Forgets the App, its installations and the tokens cached for them. GitHub is not asked to
 * delete anything.
 */
export async function deleteApp() {
  const { count } = await prisma.$transaction(async (tx) => {
    await tx.githubInstallation.deleteMany();
    await tx.githubSetupState.deleteMany();
    return tx.githubApp.deleteMany({ where: { id: GITHUB_APP_ROW_ID } });
  });
  if (count === 0) throw new AppError(404, 'No GitHub App is set up', 'NOT_FOUND');
  clearInstallationTokens();
  return {
    deleted: true,
    note: 'The App is forgotten here only. It still exists on GitHub: delete it there under Settings, Developer settings, GitHub Apps.',
  };
}
