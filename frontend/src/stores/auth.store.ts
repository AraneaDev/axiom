import { create } from 'zustand';
import type { User } from '@/lib/types';
import { setTokens, clearTokens, getAccessToken } from '@/api/client';
import { authApi } from '@/api/auth.api';
import { usersApi } from '@/api/users.api';

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
  logout: () => void;
  loadUser: () => Promise<void>;
}

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
    } catch (err: any) {
      if (err.code === 'TWO_FACTOR_REQUIRED') {
        return { twoFactorRequired: true };
      }
      throw err;
    }
  },

  logout: () => {
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
    } catch {
      // Clear stale tokens so we don't retry on next load
      clearTokens();
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
