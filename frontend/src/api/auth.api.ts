import { post } from './client';

import type { AuthResponse } from '@/lib/types';

/** Authentication API client for register, login, token refresh, and two-factor authentication. */
export const authApi = {
  /**
   * Register a new user account.
   * @param data
   * @param data.email
   * @param data.username
   * @param data.displayName
   * @param data.password
   */
  register: (data: { email: string; username: string; displayName: string; password: string }) =>
    post<AuthResponse>('/auth/register', data),

  /**
   * Log in with username/email and password, with optional 2FA code.
   * @param data
   * @param data.login
   * @param data.password
   * @param data.twoFactorCode
   */
  login: (data: { login: string; password: string; twoFactorCode?: string }) =>
    post<AuthResponse>('/auth/login', data),

  /**
   * Refresh an expired access token using a refresh token.
   * @param refreshToken
   */
  refresh: (refreshToken: string) =>
    post<{ accessToken: string; refreshToken: string }>('/auth/refresh', { refreshToken }),

  /** Begin 2FA setup; returns the TOTP secret and otpauth URL for QR display. */
  enable2FA: () => post<{ secret: string; otpauthUrl: string }>('/auth/2fa/enable', {}),

  /**
   * Verify a TOTP code to complete 2FA enrollment.
   * @param code
   */
  verify2FA: (code: string) => post<{ enabled: boolean }>('/auth/2fa/verify', { code }),

  /**
   * Disable 2FA by providing a valid TOTP code.
   * @param code
   */
  disable2FA: (code: string) => post<{ enabled: boolean }>('/auth/2fa/disable', { code }),

  forgotPassword: (email: string) => post<{ success: boolean }>('/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    post<{ success: boolean }>('/auth/reset-password', { token, password }),
};
