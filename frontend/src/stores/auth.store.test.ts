import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMe, logout, tokens } = vi.hoisted(() => ({
  getMe: vi.fn(),
  logout: vi.fn(),
  tokens: { refresh: null as string | null, cleared: 0 },
}));

vi.mock('@/api/auth.api', () => ({ authApi: { logout } }));
vi.mock('@/api/users.api', () => ({ usersApi: { getMe } }));
vi.mock('@/api/client', () => ({
  setTokens: vi.fn(),
  getAccessToken: () => tokens.refresh,
  getRefreshToken: () => tokens.refresh,
  clearTokens: () => {
    tokens.refresh = null;
    tokens.cleared++;
  },
}));

import { useAuthStore } from './auth.store';

describe('logout', () => {
  beforeEach(() => {
    logout.mockReset();
    logout.mockResolvedValue(undefined);
    tokens.refresh = 'refresh-1';
    tokens.cleared = 0;
    useAuthStore.setState({ user: { id: 'u' } as never, isAuthenticated: true });
  });

  it('revokes the refresh token on the server before clearing it', async () => {
    logout.mockImplementation(async () => {
      expect(tokens.cleared).toBe(0);
    });
    await useAuthStore.getState().logout();
    expect(logout).toHaveBeenCalledExactlyOnceWith('refresh-1');
    expect(tokens.cleared).toBe(1);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('signs out locally when the server call fails', async () => {
    logout.mockRejectedValue(new Error('offline'));
    await useAuthStore.getState().logout();
    expect(tokens.cleared).toBe(1);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('revokes the rotated token when the call had to refresh first', async () => {
    logout.mockImplementationOnce(async () => {
      tokens.refresh = 'refresh-2';
    });
    await useAuthStore.getState().logout();
    expect(logout.mock.calls).toEqual([['refresh-1'], ['refresh-2']]);
  });
});

describe('loadUser', () => {
  beforeEach(() => {
    getMe.mockReset();
    tokens.refresh = 'refresh-1';
    tokens.cleared = 0;
  });

  it('keeps the session when the request never got an answer', async () => {
    // A navigation aborts the request in flight, and so does a lost network
    getMe.mockRejectedValue(new TypeError('Failed to fetch'));
    await useAuthStore.getState().loadUser();
    expect(tokens.cleared).toBe(0);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('keeps the session on a server error', async () => {
    getMe.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    await useAuthStore.getState().loadUser();
    expect(tokens.cleared).toBe(0);
  });

  it.each([401, 403])('drops the tokens the server refuses with %i', async (status) => {
    getMe.mockRejectedValue(Object.assign(new Error('no'), { status }));
    await useAuthStore.getState().loadUser();
    expect(tokens.cleared).toBe(1);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
