import { create } from 'zustand';

import { authApi } from '@/api/auth.api';
import { setTokens, clearTokens, getAccessToken, getRefreshToken } from '@/api/client';
import { usersApi } from '@/api/users.api';
import type { User } from '@/lib/types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  register: (data: {
    email: string;
    username: string;
    displayName: string;
    password: string;
  }) => Promise<void>;
  login: (
    login: string,
    password: string,
    twoFactorCode?: string,
  ) => Promise<{ twoFactorRequired?: boolean }>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}

/**
 * Authentication store managing user session state.
 * Provides register, login, logout, and loadUser actions.
 * Tokens are persisted in localStorage and refreshed automatically by the API client.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  register: async (data) => {
    const res = await authApi.register(data);
    setTokens(res.accessToken, res.refreshToken);
    set({ user: res.user, isAuthenticated: true });
  },

  login: async (login, password, twoFactorCode?) => {
    try {
      const res = await authApi.login({ login, password, twoFactorCode });
      setTokens(res.accessToken, res.refreshToken);
      set({ user: res.user, isAuthenticated: true });
      return {};
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'TWO_FACTOR_REQUIRED') {
        return { twoFactorRequired: true };
      }
      throw err;
    }
  },

  logout: async () => {
    // The server forgets the refresh token first, so a copy of it can't mint access tokens. A
    // failure here must not keep anyone signed in.
    const sent = getRefreshToken();
    if (sent) await authApi.logout(sent).catch(() => {});
    // An expired access token makes the call above refresh first, which rotates the token it sent
    const rotated = getRefreshToken();
    if (rotated && rotated !== sent) await authApi.logout(rotated).catch(() => {});
    clearTokens();
    set({ user: null, isAuthenticated: false });
  },

  loadUser: async () => {
    if (!getAccessToken()) {
      set({ user: null, isAuthenticated: false, isLoading: false });
      return;
    }
    try {
      const user = await usersApi.getMe();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (err: unknown) {
      // Only an answer says the tokens are no good. Without one (a navigation aborts the request,
      // the network is down) they stay, or a reload at the wrong moment signs you out.
      const { status } = err as { status?: number };
      if (status === 401 || status === 403) clearTokens();
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
