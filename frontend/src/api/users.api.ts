import type { User, ApiToken, SshKey } from '@/lib/types';

import { get, post, patch, del } from './client';

interface UserSearchResult {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Users API client for profile management, SSH keys, and API tokens. */
export const usersApi = {
  /**
   * Search users by username or display name.
   * @param q
   */
  search: (q: string) => get<UserSearchResult[]>(`/users/search?q=${encodeURIComponent(q)}`),
  /** Get the currently authenticated user's profile. */
  getMe: () => get<User>('/users/me'),
  /**
   * Update the current user's display name or avatar.
   * @param data
   * @param data.displayName
   * @param data.avatarUrl
   */
  updateMe: (data: { displayName?: string; avatarUrl?: string }) => patch<User>('/users/me', data),
  /** List the current user's SSH keys. */
  listSshKeys: () => get<SshKey[]>('/users/me/ssh-keys'),
  /**
   * Add a new SSH public key for git access.
   * @param data
   * @param data.title
   * @param data.publicKey
   */
  addSshKey: (data: { title: string; publicKey: string }) =>
    post<SshKey>('/users/me/ssh-keys', data),
  /**
   * Delete an SSH key by ID.
   * @param keyId
   */
  deleteSshKey: (keyId: string) => del(`/users/me/ssh-keys/${keyId}`),
  /** List the current user's API tokens. */
  listApiTokens: () => get<ApiToken[]>('/users/me/tokens'),
  /**
   * Create a new API token with specified scopes and expiration.
   * @param data
   * @param data.name
   * @param data.scopes
   * @param data.expiresInDays
   */
  createApiToken: (data: { name: string; scopes: string[]; expiresInDays?: number }) =>
    post<ApiToken>('/users/me/tokens', data),
  /**
   * Delete an API token by ID.
   * @param tokenId
   */
  deleteApiToken: (tokenId: string) => del(`/users/me/tokens/${tokenId}`),
};
