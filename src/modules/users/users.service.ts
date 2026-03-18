import crypto from 'crypto';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

// ─── Profile ────────────────────────────────────────────────

/**
 *
 * @param userId
 */
export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      twoFactorEnabled: true,
      createdAt: true,
    },
  });
  if (!user) throw new AppError(404, 'User not found');
  return user;
}

/**
 *
 * @param userId
 * @param data
 * @param data.displayName
 * @param data.avatarUrl
 */
export async function updateProfile(
  userId: string,
  data: { displayName?: string; avatarUrl?: string },
) {
  return prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, email: true, username: true, displayName: true, avatarUrl: true },
  });
}

// ─── SSH Keys ───────────────────────────────────────────────

function parseAndFingerprintKey(publicKey: string): string {
  // Extract the key data (second field of "type base64data comment")
  const parts = publicKey.trim().split(/\s+/);
  if (parts.length < 2) throw new AppError(400, 'Invalid SSH public key format');

  const keyData = Buffer.from(parts[1], 'base64');
  const hash = crypto.createHash('sha256').update(keyData).digest('base64');
  return `SHA256:${hash.replace(/=+$/, '')}`;
}

/**
 *
 * @param userId
 */
export async function listSshKeys(userId: string) {
  return prisma.sshKey.findMany({
    where: { userId },
    select: { id: true, title: true, fingerprint: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 *
 * @param userId
 * @param data
 * @param data.title
 * @param data.publicKey
 */
export async function addSshKey(userId: string, data: { title: string; publicKey: string }) {
  const fingerprint = parseAndFingerprintKey(data.publicKey);

  const existing = await prisma.sshKey.findUnique({ where: { fingerprint } });
  if (existing) throw new AppError(409, 'SSH key already registered');

  return prisma.sshKey.create({
    data: {
      userId,
      title: data.title,
      publicKey: data.publicKey.trim(),
      fingerprint,
    },
    select: { id: true, title: true, fingerprint: true, createdAt: true },
  });
}

/**
 *
 * @param userId
 * @param keyId
 */
export async function deleteSshKey(userId: string, keyId: string) {
  const key = await prisma.sshKey.findFirst({ where: { id: keyId, userId } });
  if (!key) throw new AppError(404, 'SSH key not found');
  await prisma.sshKey.delete({ where: { id: keyId } });
}

// ─── API Tokens ─────────────────────────────────────────────

/**
 *
 * @param userId
 */
export async function listApiTokens(userId: string) {
  return prisma.apiToken.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 *
 * @param userId
 * @param data
 * @param data.name
 * @param data.scopes
 * @param data.expiresInDays
 */
export async function createApiToken(
  userId: string,
  data: {
    name: string;
    scopes: string[];
    expiresInDays?: number;
  },
) {
  // Generate token: tk_ prefix + 48 random bytes
  const rawToken = `tk_${crypto.randomBytes(48).toString('hex')}`;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const prefix = rawToken.slice(0, 11); // "tk_" + first 8 hex chars

  const token = await prisma.apiToken.create({
    data: {
      userId,
      name: data.name,
      tokenHash,
      prefix,
      scopes: data.scopes,
      expiresAt: data.expiresInDays
        ? new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000)
        : null,
    },
    select: { id: true, name: true, prefix: true, scopes: true, createdAt: true, expiresAt: true },
  });

  // Return the raw token ONLY on creation — it's never stored or retrievable again
  return { ...token, token: rawToken };
}

/**
 *
 * @param userId
 * @param tokenId
 */
export async function deleteApiToken(userId: string, tokenId: string) {
  const token = await prisma.apiToken.findFirst({ where: { id: tokenId, userId } });
  if (!token) throw new AppError(404, 'API token not found');
  await prisma.apiToken.delete({ where: { id: tokenId } });
}
