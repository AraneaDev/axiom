import { post } from './client';
import type { AuthResponse } from '@/lib/types';

export const authApi = {
  register: (data: { email: string; username: string; displayName: string; password: string }) =>
    post<AuthResponse>('/auth/register', data),

  login: (data: { login: string; password: string; twoFactorCode?: string }) =>
    post<AuthResponse>('/auth/login', data),

  refresh: (refreshToken: string) =>
    post<{ accessToken: string; refreshToken: string }>('/auth/refresh', { refreshToken }),

  enable2FA: () => post<{ secret: string; otpauthUrl: string }>('/auth/2fa/enable', {}),

  verify2FA: (code: string) => post<{ enabled: boolean }>('/auth/2fa/verify', { code }),

  disable2FA: (code: string) => post<{ enabled: boolean }>('/auth/2fa/disable', { code }),
};
