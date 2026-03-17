import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { authenticator } from 'otplib';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import type { AuthPayload } from '../../middleware/auth';

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 30;

function generateTokens(userId: string) {
  const accessToken = jwt.sign({ userId } as AuthPayload, env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });
  const refreshToken = crypto.randomBytes(48).toString('hex');
  return { accessToken, refreshToken };
}

export async function register(data: {
  email: string;
  username: string;
  displayName: string;
  password: string;
  inviteCode?: string;
}) {
  // Validate invite code (required unless no users exist — first user is admin)
  const userCount = await prisma.user.count();
  let invite: any = null;

  if (userCount > 0) {
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
    await prisma.orgMembership.create({
      data: { userId: user.id, orgId: invite.orgId, role: invite.role },
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

export async function login(data: {
  login: string;
  password: string;
  twoFactorCode?: string;
}) {
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: data.login }, { username: data.login }],
    },
  });
  if (!user) throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');

  const valid = await bcrypt.compare(data.password, user.passwordHash);
  if (!valid) throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');

  // 2FA check
  if (user.twoFactorEnabled) {
    if (!data.twoFactorCode) {
      throw new AppError(401, '2FA code required', 'TWO_FACTOR_REQUIRED');
    }
    if (!user.twoFactorSecret) {
      throw new AppError(500, '2FA misconfigured');
    }
    const isValid = authenticator.verify({
      token: data.twoFactorCode,
      secret: user.twoFactorSecret,
    });
    if (!isValid) {
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

export async function enableTwoFactor(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'User not found');
  if (user.twoFactorEnabled) throw new AppError(400, '2FA already enabled');

  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(user.email, 'Axiom', secret);

  // Store secret (not yet enabled — user must verify first)
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: secret },
  });

  return { secret, otpauthUrl };
}

export async function verifyAndActivateTwoFactor(userId: string, code: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.twoFactorSecret) {
    throw new AppError(400, 'Call enable-2fa first');
  }

  const isValid = authenticator.verify({ token: code, secret: user.twoFactorSecret });
  if (!isValid) throw new AppError(400, 'Invalid 2FA code');

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true },
  });

  return { enabled: true };
}

export async function disableTwoFactor(userId: string, code: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.twoFactorSecret) {
    throw new AppError(400, '2FA not enabled');
  }

  const isValid = authenticator.verify({ token: code, secret: user.twoFactorSecret });
  if (!isValid) throw new AppError(401, 'Invalid 2FA code');

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });

  return { enabled: false };
}
