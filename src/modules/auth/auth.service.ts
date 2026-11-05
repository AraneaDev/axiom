import crypto from 'crypto';

import { OrgRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { generateSecret, generateURI, verifySync } from 'otplib';

import { prisma } from '../../config/database';
import { env } from '../../config/env';
import type { AuthPayload } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { logAudit } from '../audit/audit.service';
import { redeemableInviteRole } from '../orgs/org-roles';

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_TTL = '4h';
const REFRESH_TOKEN_TTL_DAYS = 30;

/**
 * Check a TOTP code against a secret.
 * otplib 13's verifySync returns `{ valid }`, not a boolean: an object is always truthy,
 * so the field is what decides. A 30 second tolerance accepts the code of the
 * neighbouring period, for a code typed at the edge of one.
 * @param token - The six-digit code the user typed
 * @param secret - The user's stored TOTP secret
 * @returns Whether the code is valid now
 */
function isValidTotp(token: string, secret: string): boolean {
  return verifySync({ token, secret, epochTolerance: 30 }).valid === true;
}

function generateTokens(userId: string) {
  const accessToken = jwt.sign({ userId } as AuthPayload, env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });
  const refreshToken = crypto.randomBytes(48).toString('hex');
  return { accessToken, refreshToken };
}

/**
 * Register a new user account. Requires an invite code unless this is the first user (admin bootstrap).
 * @param data - Registration data including email, username, displayName, password, and optional inviteCode
 * @param data.email
 * @param data.username
 * @param data.displayName
 * @param data.password
 * @param data.inviteCode
 * @returns The created user with access and refresh tokens
 * @throws {AppError} 403 if invite code is missing, invalid, expired, or exhausted
 * @throws {AppError} 409 if email or username already taken
 */
export async function register(data: {
  email: string;
  username: string;
  displayName: string;
  password: string;
  inviteCode?: string;
}) {
  // Validate invite code (required unless no users exist — first user is admin)
  const { getSiteSettings } = await import('../site-settings/site-settings.service');
  const settings = await getSiteSettings();

  if (settings.registrationMode === 'DISABLED') {
    throw new AppError(403, 'Registration is currently disabled', 'REGISTRATION_DISABLED');
  }

  const userCount = await prisma.user.count();
  let invite: {
    id: string;
    orgId: string;
    role: string;
    createdBy: string;
    expiresAt: Date | null;
    uses: number;
    maxUses: number;
  } | null = null;

  if (userCount > 0 && settings.registrationMode === 'INVITE_ONLY') {
    if (!data.inviteCode) {
      throw new AppError(403, 'Registration requires an invite link', 'INVITE_REQUIRED');
    }
    invite = await prisma.inviteLink.findUnique({ where: { code: data.inviteCode } });
    if (!invite) {
      throw new AppError(403, 'Invalid invite code', 'INVALID_INVITE');
    }
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new AppError(403, 'Invite link has expired', 'INVITE_EXPIRED');
    }
    if (invite.uses >= invite.maxUses) {
      throw new AppError(403, 'Invite link has been fully used', 'INVITE_EXHAUSTED');
    }
  } else if (userCount > 0 && data.inviteCode) {
    // OPEN mode: still process invite code if provided (for org assignment)
    invite = await prisma.inviteLink.findUnique({ where: { code: data.inviteCode } });
    if (invite && invite.expiresAt && invite.expiresAt < new Date()) {
      invite = null;
    }
    if (invite && invite.uses >= invite.maxUses) {
      invite = null;
    }
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: data.email }, { username: data.username }] },
  });
  if (existing) {
    throw new AppError(409, 'Email or username already taken', 'CONFLICT');
  }

  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: {
      email: data.email,
      username: data.username,
      displayName: data.displayName,
      passwordHash,
    },
    select: { id: true, email: true, username: true, displayName: true, createdAt: true },
  });

  // If invite was used, add user to the org and increment usage
  if (invite) {
    // Never more than the link's creator holds now (see redeemableInviteRole)
    const role = await redeemableInviteRole(invite.orgId, invite.createdBy, invite.role as OrgRole);
    await prisma.orgMembership.create({
      data: { userId: user.id, orgId: invite.orgId, role },
    });
    await prisma.inviteLink.update({
      where: { id: invite.id },
      data: { uses: { increment: 1 } },
    });
  }

  const { accessToken, refreshToken } = generateTokens(user.id);
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  return { user, accessToken, refreshToken };
}

/**
 * Authenticate a user by email/username and password, with optional 2FA verification.
 * @param data - Login credentials including login (email or username), password, and optional twoFactorCode
 * @param data.login
 * @param data.password
 * @param data.twoFactorCode
 * @returns The authenticated user with access and refresh tokens
 * @throws {AppError} 401 if credentials invalid, 2FA code required, or 2FA code invalid
 */
export async function login(data: { login: string; password: string; twoFactorCode?: string }) {
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: data.login }, { username: data.login }],
    },
  });
  if (!user) throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');

  const valid = await bcrypt.compare(data.password, user.passwordHash);
  if (!valid) {
    logAudit({
      userId: user.id,
      action: 'login_failed',
      resourceType: 'user',
      resourceId: user.id,
      details: { reason: 'invalid_password', username: user.username },
    }).catch(() => {
      /* fire-and-forget */
    });
    throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }

  // 2FA check
  if (user.twoFactorEnabled) {
    if (!data.twoFactorCode) {
      throw new AppError(401, '2FA code required', 'TWO_FACTOR_REQUIRED');
    }
    if (!user.twoFactorSecret) {
      throw new AppError(500, '2FA misconfigured');
    }
    if (!isValidTotp(data.twoFactorCode, user.twoFactorSecret)) {
      throw new AppError(401, 'Invalid 2FA code', 'INVALID_TWO_FACTOR');
    }
  }

  const { accessToken, refreshToken } = generateTokens(user.id);
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  // Audit: log successful login
  logAudit({
    userId: user.id,
    action: 'login',
    resourceType: 'user',
    resourceId: user.id,
    details: { username: user.username },
  }).catch(() => {
    /* fire-and-forget */
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
    },
    accessToken,
    refreshToken,
  };
}

/**
 * Rotate a refresh token, issuing a new access/refresh token pair and invalidating the old one.
 * @param refreshTokenValue - The current refresh token to rotate
 * @returns New access and refresh tokens
 * @throws {AppError} 401 if refresh token is invalid or expired
 */
export async function refresh(refreshTokenValue: string) {
  const tokenHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');

  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.expiresAt < new Date()) {
    throw new AppError(401, 'Invalid or expired refresh token', 'INVALID_REFRESH');
  }

  // Rotate: delete old, issue new
  await prisma.refreshToken.delete({ where: { id: stored.id } });

  const { accessToken, refreshToken: newRefreshToken } = generateTokens(stored.userId);
  const newHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');

  await prisma.refreshToken.create({
    data: {
      userId: stored.userId,
      tokenHash: newHash,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  return { accessToken, refreshToken: newRefreshToken };
}

/**
 * Log out by deleting the refresh token and recording an audit event.
 * @param userId - The user logging out
 * @param refreshTokenValue - Optional refresh token to invalidate
 * @returns Success indicator
 */
export async function logout(userId: string, refreshTokenValue?: string) {
  if (refreshTokenValue) {
    const tokenHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');
    await prisma.refreshToken.deleteMany({ where: { tokenHash } });
  }

  // Audit: log logout
  logAudit({
    userId,
    action: 'logout',
    resourceType: 'user',
    resourceId: userId,
  }).catch(() => {
    /* fire-and-forget */
  });

  return { success: true };
}

/**
 * Begin 2FA setup by generating a TOTP secret and otpauth URL for QR code display.
 * @param userId - The user ID
 * @returns The TOTP secret and otpauth URL for authenticator app enrollment
 * @throws {AppError} 404 if user not found
 * @throws {AppError} 400 if 2FA is already enabled
 */
export async function enableTwoFactor(userId: string) {
  const user = await findOrThrow(
    prisma.user.findUnique({ where: { id: userId } }),
    ERR.USER_NOT_FOUND,
  );
  if (user.twoFactorEnabled) throw new AppError(400, '2FA already enabled');

  const secret = generateSecret();
  const otpauthUrl = generateURI({ label: user.email, issuer: 'Axiom', secret });

  // Store secret (not yet enabled — user must verify first)
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: secret },
  });

  return { secret, otpauthUrl };
}

/**
 * Verify a TOTP code and activate 2FA on the user's account.
 * @param userId - The user ID
 * @param code - The TOTP code from the authenticator app
 * @returns Object indicating 2FA is now enabled
 * @throws {AppError} 400 if enable-2fa was not called first or code is invalid
 */
export async function verifyAndActivateTwoFactor(userId: string, code: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.twoFactorSecret) {
    throw new AppError(400, 'Call enable-2fa first');
  }

  if (!isValidTotp(code, user.twoFactorSecret)) throw new AppError(400, 'Invalid 2FA code');

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true },
  });

  logAudit({
    userId,
    action: '2fa_enabled',
    resourceType: 'user',
    resourceId: userId,
  }).catch(() => {
    /* fire-and-forget */
  });

  return { enabled: true };
}

/**
 * Disable 2FA on a user's account after verifying a valid TOTP code.
 * @param userId - The user ID
 * @param code - The TOTP code to verify before disabling
 * @returns Object indicating 2FA is now disabled
 * @throws {AppError} 400 if 2FA is not enabled
 * @throws {AppError} 401 if TOTP code is invalid
 */
export async function disableTwoFactor(userId: string, code: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.twoFactorSecret) {
    throw new AppError(400, '2FA not enabled');
  }

  if (!isValidTotp(code, user.twoFactorSecret)) throw new AppError(401, 'Invalid 2FA code');

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });

  logAudit({
    userId,
    action: '2fa_disabled',
    resourceType: 'user',
    resourceId: userId,
  }).catch(() => {
    /* fire-and-forget */
  });

  return { enabled: false };
}

const PASSWORD_RESET_TTL_HOURS = 1;

/**
 *
 * @param email
 */
export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { success: true };

  logAudit({
    userId: user.id,
    action: 'password_reset_requested',
    resourceType: 'user',
    resourceId: user.id,
    details: { email: user.email },
  }).catch(() => {
    /* fire-and-forget */
  });

  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

  const token = crypto.randomBytes(48).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000),
    },
  });

  const { emailQueue } = await import('../../email/queue');
  await emailQueue.add('password-reset', {
    to: user.email,
    recipientName: user.displayName,
    type: 'password_reset',
    title: 'Password Reset',
    body: 'You requested a password reset. Click the link below to set a new password. This link expires in 1 hour.',
    link: `/reset-password/${token}`,
  });

  return { success: true };
}

/**
 *
 * @param token
 * @param newPassword
 */
export async function resetPassword(token: string, newPassword: string) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const stored = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.expiresAt < new Date()) {
    throw new AppError(400, 'Invalid or expired reset token', 'INVALID_RESET_TOKEN');
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.delete({ where: { id: stored.id } }),
    prisma.refreshToken.deleteMany({ where: { userId: stored.userId } }),
  ]);

  return { success: true };
}
