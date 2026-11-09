import { describe, it, expect } from 'vitest';

import { USER_BASIC_SELECT, USER_WITH_AVATAR_SELECT } from './prisma-selects';

describe('Prisma select constants', () => {
  it('USER_BASIC_SELECT has correct fields', () => {
    expect(Object.keys(USER_BASIC_SELECT).sort()).toEqual([
      'displayName',
      'id',
      'kind',
      'username',
    ]);
    expect(Object.values(USER_BASIC_SELECT).every((v) => v === true)).toBe(true);
  });

  it('USER_WITH_AVATAR_SELECT has correct fields', () => {
    expect(Object.keys(USER_WITH_AVATAR_SELECT).sort()).toEqual([
      'avatarUrl',
      'displayName',
      'id',
      'kind',
      'username',
    ]);
    expect(Object.values(USER_WITH_AVATAR_SELECT).every((v) => v === true)).toBe(true);
  });

  it('USER_WITH_AVATAR_SELECT is a superset of USER_BASIC_SELECT', () => {
    for (const key of Object.keys(USER_BASIC_SELECT)) {
      expect(USER_WITH_AVATAR_SELECT).toHaveProperty(key);
    }
  });
});
