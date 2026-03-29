import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Shield, Trash2, Users } from 'lucide-react';
import { useState } from 'react';

import { spacePermissionsApi, type SpacePermission } from '@/api/space-permissions.api';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';

const LEVELS = ['VIEW', 'EDIT', 'ADMIN'] as const;
const TEAM_ROLES = ['ADMIN', 'MEMBER', 'VIEWER'] as const;

interface SpacePermissionsProps {
  spaceId: string;
}

/**
 * Space permissions management panel.
 * Shows existing permissions and allows adding/editing/removing them.
 * @param root0
 * @param root0.spaceId
 */
export function SpacePermissions({ spaceId }: SpacePermissionsProps) {
  const queryClient = useQueryClient();
  const [newType, setNewType] = useState<'user' | 'role'>('role');
  const [newUserId, setNewUserId] = useState('');
  const [newTeamRole, setNewTeamRole] = useState<string>(TEAM_ROLES[1]);
  const [newLevel, setNewLevel] = useState<(typeof LEVELS)[number]>('VIEW');
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: permissions, isLoading } = useQuery({
    queryKey: ['space-permissions', spaceId],
    queryFn: () => spacePermissionsApi.list(spaceId),
  });

  const upsertMutation = useMutation({
    mutationFn: (data: { userId?: string; teamRole?: string; level: string }) =>
      spacePermissionsApi.upsert(spaceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-permissions', spaceId] });
      setNewUserId('');
      setShowAddForm(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (permissionId: string) => spacePermissionsApi.remove(spaceId, permissionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-permissions', spaceId] });
    },
  });

  const updateLevelMutation = useMutation({
    mutationFn: (data: { permission: SpacePermission; level: string }) =>
      spacePermissionsApi.upsert(spaceId, {
        userId: data.permission.userId ?? undefined,
        teamRole: data.permission.teamRole ?? undefined,
        level: data.level,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-permissions', spaceId] });
    },
  });

  function handleAdd() {
    if (newType === 'user') {
      if (!newUserId.trim()) return;
      upsertMutation.mutate({ userId: newUserId.trim(), level: newLevel });
    } else {
      upsertMutation.mutate({ teamRole: newTeamRole, level: newLevel });
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (!permissions?.length && !showAddForm) {
    return (
      <EmptyState
        icon={<Lock />}
        title="No custom permissions"
        description="All team members have full access to this space. Add permissions to restrict access."
        action={
          <Button variant="primary" size="sm" onClick={() => setShowAddForm(true)}>
            <Shield className="h-4 w-4" /> Add Permission
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text flex items-center gap-2">
          <Shield className="h-4 w-4 text-text-secondary" />
          Space Permissions
        </h3>
        {!showAddForm && (
          <Button variant="outline" size="xs" onClick={() => setShowAddForm(true)}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        )}
      </div>

      {permissions && permissions.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-secondary">
                <th className="text-left px-3 py-2 text-xs font-medium text-text-secondary">
                  User / Role
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-text-secondary">
                  Level
                </th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light">
              {permissions.map((perm) => (
                <tr key={perm.id} className="hover:bg-surface-secondary transition-colors">
                  <td className="px-3 py-2">
                    {perm.user ? (
                      <div className="flex items-center gap-2">
                        <Avatar
                          name={perm.user.displayName}
                          src={perm.user.avatarUrl ?? undefined}
                          size="xs"
                        />
                        <span className="text-text font-medium">{perm.user.displayName}</span>
                        <span className="text-text-tertiary text-xs">@{perm.user.username}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-text-secondary" />
                        <Badge variant="outline" size="sm">
                          {perm.teamRole} role
                        </Badge>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={perm.level}
                      onChange={(e) =>
                        updateLevelMutation.mutate({
                          permission: perm,
                          level: e.target.value,
                        })
                      }
                      className="bg-surface border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      variant="ghost"
                      size="xs"
                      title="Remove permission"
                      onClick={() => removeMutation.mutate(perm.id)}
                      disabled={removeMutation.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-danger" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddForm && (
        <div className="rounded-lg border border-border p-3 bg-surface-secondary space-y-3">
          <div className="flex items-center gap-2">
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as 'user' | 'role')}
              className="bg-surface border border-border rounded px-2 py-1.5 text-xs text-text focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="role">Team Role</option>
              <option value="user">User ID</option>
            </select>

            {newType === 'user' ? (
              <input
                type="text"
                value={newUserId}
                onChange={(e) => setNewUserId(e.target.value)}
                placeholder="User ID"
                className="flex-1 bg-surface border border-border rounded px-2 py-1.5 text-xs text-text placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <select
                value={newTeamRole}
                onChange={(e) => setNewTeamRole(e.target.value)}
                className="bg-surface border border-border rounded px-2 py-1.5 text-xs text-text focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {TEAM_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}

            <select
              value={newLevel}
              onChange={(e) => setNewLevel(e.target.value as (typeof LEVELS)[number])}
              className="bg-surface border border-border rounded px-2 py-1.5 text-xs text-text focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="xs"
              onClick={handleAdd}
              disabled={upsertMutation.isPending || (newType === 'user' && !newUserId.trim())}
            >
              <Plus className="h-3.5 w-3.5" /> Add Permission
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setShowAddForm(false)}>
              <Lock className="h-3.5 w-3.5" /> Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
