import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Search,
  Eye,
  Trash2,
  ArrowLeft,
  Shield,
  Mail,
  Calendar,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { adminApi } from '@/api/admin.api';
import type { AdminUser } from '@/api/admin.api';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { formatRelative } from '@/lib/utils';

const PAGE_SIZE = 20;

// ─── User Detail Modal ─────────────────────────────────────

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

// ─── Delete Confirmation ────────────────────────────────────

function DeleteConfirmModal({
  user,
  onClose,
  onConfirm,
  isDeleting,
}: {
  user: AdminUser;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}) {
  return (
    <Modal open onClose={onClose} title="Delete User">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Are you sure you want to delete{' '}
          <span className="font-semibold text-text">@{user.username}</span>? This action cannot be
          undone. All their data will be permanently removed.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isDeleting}>
            <ArrowLeft className="h-4 w-4" /> Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm} disabled={isDeleting}>
            <Trash2 className="h-4 w-4" /> {isDeleting ? 'Deleting...' : 'Delete User'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main ───────────────────────────────────────────────────

/**
 *
 */
export default function UserManagement() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [viewUser, setViewUser] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const queryClient = useQueryClient();
  const { success, error: showError } = useToast();

  // Debounce search
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const handleSearch = (value: string) => {
    setSearch(value);
    if (debounceTimer) clearTimeout(debounceTimer);
    const timer = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(0);
    }, 300);
    setDebounceTimer(timer);
  };

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', debouncedSearch, page],
    queryFn: () =>
      adminApi.listUsers({
        search: debouncedSearch || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => adminApi.deleteUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      success('User deleted successfully');
      setDeleteTarget(null);
    },
    onError: () => {
      showError('Failed to delete user');
    },
  });

  const handleViewUser = async (user: AdminUser) => {
    try {
      const detail = await adminApi.getUser(user.id);
      setViewUser(detail);
    } catch {
      setViewUser(user);
    }
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/admin">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-text">User Management</h1>
            <p className="text-sm text-text-secondary mt-1">
              {data ? `${data.total} users total` : 'Loading...'}
            </p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
        <Input
          placeholder="Search users..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <PageLoader />
      ) : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-secondary">
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-tertiary uppercase tracking-wide">
                  User
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-tertiary uppercase tracking-wide">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-tertiary uppercase tracking-wide">
                  Role
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-tertiary uppercase tracking-wide">
                  Joined
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-text-tertiary uppercase tracking-wide">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {data?.users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-border-light last:border-0 hover:bg-surface-secondary transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={user.displayName} src={user.avatarUrl} size="sm" />
                      <div>
                        <p className="font-medium text-text">{user.displayName}</p>
                        <p className="text-xs text-text-tertiary">@{user.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{user.email}</td>
                  <td className="px-4 py-3">
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
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {formatRelative(user.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewUser(user)}
                        title="View user details"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(user)}
                        title="Delete user"
                        className="text-danger hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {data?.users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-tertiary">
                    <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    No users found
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <p className="text-xs text-text-tertiary">
                Page {page + 1} of {totalPages}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {viewUser && <UserDetailModal user={viewUser} onClose={() => setViewUser(null)} />}
      {deleteTarget && (
        <DeleteConfirmModal
          user={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
