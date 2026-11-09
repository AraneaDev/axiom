import { describe, expect, it, vi } from 'vitest';

// The api client reads its tokens from localStorage when it loads
vi.hoisted(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

import { ApiError } from './client';
import { serviceAccountError } from './service-accounts.api';

describe('serviceAccountError', () => {
  it.each([
    'SERVICE_ACCOUNT_DEACTIVATED',
    'SERVICE_ACCOUNT_NOT_APPROVER',
    'SERVICE_ACCOUNT_NOT_ASSIGNABLE',
    'SERVICE_ACCOUNT_NOT_INVITABLE',
    'SERVICE_ACCOUNT_NOT_WATCHER',
    'SERVICE_ACCOUNT_OWNER_NEEDED',
    'SERVICE_ACCOUNT_ROLE_LIMIT',
  ])('says %s in plain words, not the server text', (code) => {
    const message = serviceAccountError(new ApiError(400, 'server text', code));
    expect(message).not.toBe('server text');
    expect(message).toMatch(/\.$/);
  });

  it('falls back to the server message for an unknown code, and to the fallback for nothing', () => {
    expect(serviceAccountError(new ApiError(400, 'server text', 'SOMETHING_ELSE'))).toBe(
      'server text',
    );
    expect(serviceAccountError(null, 'Fallback')).toBe('Fallback');
  });
});
