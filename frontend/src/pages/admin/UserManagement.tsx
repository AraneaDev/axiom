import { useQuery } from '@tanstack/react-query';
import {
  Users,
  Search,
  Eye,
  Trash2,
  ArrowLeft,
  Shield,
  Mail,
  Calendar,
  UserX,
  UserCheck,
  KeyRound,
  ShieldOff,
  AlertTriangle,
} from 'lucide-react';
import { useState } from 'react';

import { adminApi } from '@/api/admin.api';
import type { AdminUser } from '@/api/admin.api';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { Table, TableContainer, Tbody, Td, Th, Thead, Tr, TrHead } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useDebounce } from '@/hooks/useDebounce';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { formatRelative } from '@/lib/utils';

const PAGE_SIZE = 20;

// --- User Detail Modal ---

function UserDetailModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="User Details">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar name={user.displayName} src={user.avatarUrl} size="lg" />
          <div>
            <p className="font-semibold text-text">{user.displayName}</p>
            <p className="text-sm text-text-secondary">@{user.username}</p>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-text-secondary">
            <Mail className="h-4 w-4" />
            <span>{user.email}</span>
          </div>
          <div className="flex items-center gap-2 text-text-secondary">
            <Calendar className="h-4 w-4" />
            <span>Joined {formatRelative(user.createdAt)}</span>
          </div>
          <div className="flex items-center gap-2 text-text-secondary">
            <Shield className="h-4 w-4" />
            <span>2FA {user.twoFactorEnabled ? 'Enabled' : 'Disabled'}</span>
          </div>
        </div>

        {user.orgMemberships.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">
              Organizations
            </p>
            <div className="space-y-1">
              {user.orgMemberships.map((m) => (
                <div
                  key={m.org.id}
                  className="flex items-center justify-between rounded-lg bg-surface-secondary px-3 py-2"
                >
                  <span className="text-sm text-text">{m.org.name}</span>
                  <Badge variant="outline" size="sm">
                    {m.role}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {user.teamMemberships && user.teamMemberships.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">
              Teams
            </p>
            <div className="space-y-1">
              {user.teamMemberships.map((m) => (
                <div
                  key={m.team.id}
                  className="flex items-center justify-between rounded-lg bg-surface-secondary px-3 py-2"
                >
                  <span className="text-sm text-text">{m.team.name}</span>
                  <Badge variant="outline" size="sm">
                    {m.role}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            <Eye className="h-4 w-4" /> Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// --- Reset Password Modal ---

function ResetPasswordModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [newPassword, setNewPassword] = useState('');
  const [isPending, setIsPending] = useState(false);
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPending(true);
    try {
      await adminApi.resetPassword(user.id, newPassword);
      toast.success('Password reset successfully');
      onClose();
    } catch {
      toast.error('Failed to reset password');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Reset Password">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-text-secondary">
          Set a new password for <span className="font-medium text-text">@{user.username}</span>.
          Their active sessions will be invalidated.
        </p>
        <Input
          label="New Password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Min. 8 characters"
          required
          minLength={8}
          maxLength={128}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" type="button" onClick={onClose}>
            <ArrowLeft className="h-4 w-4" /> Cancel
          </Button>
          <Button size="sm" type="submit" disabled={isPending || newPassword.length < 8}>
            <KeyRound className="h-4 w-4" /> Reset Password
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// --- Main ---

/**
 *
 */
export default function UserManagement() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [page, setPage] = useState(0);
  const [viewUser, setViewUser] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [resetPasswordTarget, setResetPasswordTarget] = useState<AdminUser | null>(null);
  const [resetTwoFactorTarget, setResetTwoFactorTarget] = useState<AdminUser | null>(null);

  const toast = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'users', debouncedSearch, page],
    queryFn: () =>
      adminApi.listUsers({
        search: debouncedSearch || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  });

  const deleteMutation = useMutationWithToast((userId: string) => adminApi.deleteUser(userId), {
    successMessage: 'User deleted successfully',
    errorMessage: 'Failed to delete user',
    invalidateKeys: [['admin', 'users']],
    onSuccess: () => setDeleteTarget(null),
  });

  const resetTwoFactorMutation = useMutationWithToast(
    (userId: string) => adminApi.resetTwoFactor(userId),
    {
      successMessage: 'Two-factor authentication turned off',
      errorMessage: 'Failed to reset two-factor authentication',
      invalidateKeys: [['admin', 'users']],
      onSuccess: () => setResetTwoFactorTarget(null),
    },
  );

  const deactivateMutation = useMutationWithToast(
    ({ userId, deactivated }: { userId: string; deactivated: boolean }) =>
      deactivated ? adminApi.reactivateUser(userId) : adminApi.deactivateUser(userId),
    {
      successMessage: null,
      errorMessage: null,
      invalidateKeys: [['admin', 'users']],
      onSuccess: (_data, vars) => {
        toast.success(vars.deactivated ? 'User reactivated' : 'User deactivated');
      },
      onError: (_err, vars) => {
        toast.error(vars.deactivated ? 'Failed to reactivate user' : 'Failed to deactivate user');
      },
    },
  );

  const handleViewUser = async (user: AdminUser) => {
    try {
      const detail = await adminApi.getUser(user.id);
      setViewUser(detail);
    } catch {
      setViewUser(user);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ButtonLink to="/admin" variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> Back
          </ButtonLink>
          <div>
            <h1 className="h2">User Management</h1>
            <p className="text-sm text-text-secondary mt-1">
              {data ? `${data.total} users total` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
        <Input
          placeholder="Search users..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          className="pl-9"
        />
      </div>

      {/* Table */}
      {error ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
            <p className="text-secondary">Failed to load users</p>
          </div>
        </div>
      ) : isLoading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : (
        <TableContainer>
          <Table>
            <Thead>
              <TrHead>
                <Th>User</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Joined</Th>
                <Th className="text-right">Actions</Th>
              </TrHead>
            </Thead>
            <Tbody>
              {data?.users.map((user) => (
                <Tr key={user.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={user.displayName} src={user.avatarUrl} size="sm" />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-text">{user.displayName}</p>
                          {user.kind === 'INTEGRATION' && (
                            <Badge variant="outline" size="sm">
                              Built in
                            </Badge>
                          )}
                          {user.deactivatedAt && (
                            <Badge variant="danger" size="sm">
                              Deactivated
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-text-tertiary">@{user.username}</p>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-text-secondary">{user.email}</Td>
                  <Td>
                    {user.orgMemberships.length > 0 ? (
                      <Badge
                        variant={user.orgMemberships[0].role === 'OWNER' ? 'default' : 'outline'}
                        size="sm"
                      >
                        {user.orgMemberships[0].role}
                      </Badge>
                    ) : (
                      <span className="text-text-tertiary text-xs">No org</span>
                    )}
                  </Td>
                  <Td className="text-text-secondary">{formatRelative(user.createdAt)}</Td>
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewUser(user)}
                        title="View user details"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {!user.isAdmin && user.kind !== 'INTEGRATION' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            deactivateMutation.mutate({
                              userId: user.id,
                              deactivated: !!user.deactivatedAt,
                            })
                          }
                          title={user.deactivatedAt ? 'Reactivate user' : 'Deactivate user'}
                          className={
                            user.deactivatedAt
                              ? 'text-success hover:text-success'
                              : 'text-warning hover:text-warning'
                          }
                          disabled={deactivateMutation.isPending}
                        >
                          {user.deactivatedAt ? (
                            <UserCheck className="h-4 w-4" />
                          ) : (
                            <UserX className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      {user.kind !== 'INTEGRATION' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setResetPasswordTarget(user)}
                          title="Reset password"
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button>
                      )}
                      {user.twoFactorEnabled && user.kind !== 'INTEGRATION' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setResetTwoFactorTarget(user)}
                          title="Reset two-factor authentication"
                          className="text-warning hover:text-warning"
                        >
                          <ShieldOff className="h-4 w-4" />
                        </Button>
                      )}
                      {user.kind !== 'INTEGRATION' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(user)}
                          title="Delete user"
                          className="text-danger hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
              {data?.users.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon={<Users />}
                      title="No users found"
                      description="Try adjusting your search query."
                    />
                  </td>
                </tr>
              )}
            </Tbody>
          </Table>

          {/* Pagination */}
          {(data?.total ?? 0) > PAGE_SIZE && (
            <div className="px-4 border-t border-border">
              <Pagination
                total={data?.total ?? 0}
                limit={PAGE_SIZE}
                offset={page * PAGE_SIZE}
                onPageChange={(offset) => setPage(Math.floor(offset / PAGE_SIZE))}
              />
            </div>
          )}
        </TableContainer>
      )}

      {/* Modals */}
      {resetPasswordTarget && (
        <ResetPasswordModal
          user={resetPasswordTarget}
          onClose={() => setResetPasswordTarget(null)}
        />
      )}
      {viewUser && <UserDetailModal user={viewUser} onClose={() => setViewUser(null)} />}
      <ConfirmDialog
        open={!!resetTwoFactorTarget}
        onClose={() => setResetTwoFactorTarget(null)}
        onConfirm={() =>
          resetTwoFactorTarget && resetTwoFactorMutation.mutate(resetTwoFactorTarget.id)
        }
        title="Reset two-factor authentication"
        description={`This turns off two-factor authentication for @${resetTwoFactorTarget?.username ?? ''} and signs them out everywhere. They sign in with their password and set it up again. Do this only when you know it is them asking.`}
        confirmLabel="Reset 2FA"
        variant="warning"
        loading={resetTwoFactorMutation.isPending}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Delete User"
        description={`Are you sure you want to delete @${deleteTarget?.username ?? ''}? This action cannot be undone. All their data will be permanently removed.`}
        confirmLabel="Delete User"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
