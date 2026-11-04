import { get, put, del } from './client';

export interface SpacePermission {
  id: string;
  spaceId: string;
  userId: string | null;
  teamRole: string | null;
  level: 'VIEW' | 'EDIT' | 'ADMIN';
  createdAt: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
}

export const spacePermissionsApi = {
  list: (spaceId: string) => get<SpacePermission[]>(`/wiki/spaces/${spaceId}/permissions`),
  upsert: (spaceId: string, data: { userId?: string; teamRole?: string; level: string }) =>
    put<SpacePermission>(`/wiki/spaces/${spaceId}/permissions`, data),
  remove: (spaceId: string, permissionId: string) =>
    del(`/wiki/spaces/${spaceId}/permissions/${permissionId}`),
};
