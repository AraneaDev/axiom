const API_BASE = '/api';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let accessToken: string | null = localStorage.getItem('accessToken');
let refreshToken: string | null = localStorage.getItem('refreshToken');
let refreshPromise: Promise<void> | null = null;

/**
 *
 * @param access
 * @param refresh
 */
export function setTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem('accessToken', access);
  localStorage.setItem('refreshToken', refresh);
}

/**
 *
 */
export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

/**
 *
 */
export function getAccessToken() {
  return accessToken;
}

async function refreshAccessToken(): Promise<void> {
  if (!refreshToken) throw new ApiError(401, 'No refresh token');

  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    clearTokens();
    throw new ApiError(401, 'Refresh failed');
  }

  const data = await res.json();
  setTokens(data.accessToken, data.refreshToken);
}

/**
 *
 * @param path
 * @param options
 */
export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // Auto-refresh on 401
  if (res.status === 401 && refreshToken) {
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
    }
    try {
      await refreshPromise;
    } catch {
      // Refresh failed -- redirect to login
      window.location.href = '/login';
      throw new ApiError(401, 'Session expired');
    }

    headers['Authorization'] = `Bearer ${accessToken}`;
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  }

  // No refresh token and still 401 -- redirect to login
  if (res.status === 401 && !refreshToken) {
    clearTokens();
    window.location.href = '/login';
    throw new ApiError(401, 'Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch((err) => {
      console.error('Failed to parse error response JSON', err);
      return {};
    });
    throw new ApiError(res.status, body.error?.message ?? 'Request failed', body.error?.code);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// Convenience methods
export const get = <T = unknown>(path: string) => api<T>(path);
export const post = <T = unknown>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T = unknown>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const put = <T = unknown>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = <T = unknown>(path: string) => api<T>(path, { method: 'DELETE' });
