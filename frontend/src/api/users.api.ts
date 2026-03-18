import { get, post, patch, del } from './client';

import type { User, ApiToken, SshKey } from '@/lib/types';

export const usersApi = {
  getMe: () => get<User>('/users/me'),
  updateMe: (data: { displayName?: string; avatarUrl?: string }) => patch<User>('/users/me', data),
  listSshKeys: () => get<SshKey[]>('/users/me/ssh-keys'),
  addSshKey: (data: { title: string; publicKey: string }) =>
    post<SshKey>('/users/me/ssh-keys', data),
  deleteSshKey: (keyId: string) => del(`/users/me/ssh-keys/${keyId}`),
  listApiTokens: () => get<ApiToken[]>('/users/me/tokens'),
  createApiToken: (data: { name: string; scopes: string[]; expiresInDays?: number }) =>
    post<ApiToken>('/users/me/tokens', data),
  deleteApiToken: (tokenId: string) => del(`/users/me/tokens/${tokenId}`),
};
