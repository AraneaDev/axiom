import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Coins, KeyRound, Plus, Trash2, Copy, X } from 'lucide-react';
import { useState } from 'react';

import { usersApi } from '@/api/users.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { Skeleton, ListSkeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/utils';

/**
 *
 */
export default function ApiTokens() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState('issues:read,wiki:read');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const {
    data: tokens,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: ['apiTokens'],
    queryFn: usersApi.listApiTokens,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      usersApi.createApiToken({ name, scopes: scopes.split(',').map((s) => s.trim()) }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['apiTokens'] });
      setNewToken(data.token ?? null);
      setShowForm(false);
      setName('');
      toast.success('Token created');
    },
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : 'Failed to create token'),
  });

  const deleteMutation = useMutation({
    mutationFn: (tokenId: string) => usersApi.deleteApiToken(tokenId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiTokens'] });
      toast.success('Token revoked');
    },
  });

  function handleRevoke(tokenId: string) {
    deleteMutation.mutate(tokenId);
  }

  if (isLoading)
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
        <ListSkeleton rows={3} />
      </div>
    );

  if (queryError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load API tokens</p>
        </div>
      </div>
    );
  }

  return (
    <SettingsPage
      title="API Tokens"
      description="Create and manage tokens for API and git HTTPS access"
      icon={Coins}
      helpTitle="Working with tokens"
      helpItems={[
        {
          title: 'Token security',
          description:
            'Tokens are shown only once at creation. Store them securely -- they cannot be retrieved later.',
        },
        {
          title: 'Scopes',
          description:
            'Scope values are comma-separated and control what the token can access. Leave empty for full access.',
        },
        {
          title: 'Git HTTPS',
          description:
            'Use a token as your password when cloning or pushing over HTTPS. Your username remains the same.',
        },
      ]}
      actions={
        <Button
          size="sm"
          onClick={() => {
            setShowForm(!showForm);
            setNewToken(null);
          }}
        >
          <Plus className="h-4 w-4" /> New Token
        </Button>
      }
    >
      {newToken && (
        <div className="rounded-lg border border-success/20 bg-success-light p-4 mb-6">
          <p className="text-sm font-medium text-success mb-2">
            Token created! Copy it now -- you won't see it again.
          </p>
          <div className="flex gap-2">
            <code className="flex-1 text-xs bg-surface border border-success/20 rounded px-3 py-2 font-mono select-all break-all">
              {newToken}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigator.clipboard.writeText(newToken)}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {showForm && (
        <Card className="p-4 mb-6">
          {error && (
            <div className="mb-3 rounded-md bg-danger-light border border-danger/20 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
          <div className="space-y-3">
            <Input
              id="tokenName"
              label="Token name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="CI/CD token"
            />
            <Input
              id="scopes"
              label="Scopes (comma-separated)"
              value={scopes}
              onChange={(e) => setScopes(e.target.value)}
              placeholder="issues:read,wiki:write"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !name}
              >
                {createMutation.isPending ? (
                  <Spinner size="sm" />
                ) : (
                  <>
                    <Plus className="h-4 w-4" /> Create token
                  </>
                )}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>
                <X className="h-4 w-4" /> Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {!tokens?.length ? (
        <EmptyState
          card
          icon={<KeyRound className="h-10 w-10" />}
          title="No API tokens"
          description="Create a token for API and MCP access."
        />
      ) : (
        <Card className="divide-y divide-border">
          {tokens.map((t) => (
            <div key={t.id} className="flex items-center gap-3 p-4">
              <KeyRound className="h-4 w-4 text-text-secondary" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-text-secondary font-mono">{t.prefix}...</p>
              </div>
              <div className="flex gap-1 flex-wrap">
                {t.scopes.map((s) => (
                  <Badge key={s} className="text-xs">
                    {s}
                  </Badge>
                ))}
              </div>
              <span className="text-xs text-text-secondary whitespace-nowrap">
                {formatDate(t.createdAt)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRevokeId(t.id)}
                title="Revoke token"
              >
                <Trash2 className="h-3.5 w-3.5 text-danger" />
              </Button>
            </div>
          ))}
        </Card>
      )}

      <ConfirmDialog
        open={!!revokeId}
        onClose={() => setRevokeId(null)}
        onConfirm={() => {
          if (revokeId) handleRevoke(revokeId);
          setRevokeId(null);
        }}
        title="Revoke Token"
        description="Are you sure you want to revoke this token? Any applications using it will lose access immediately."
        confirmLabel="Revoke"
        loading={deleteMutation.isPending}
      />
    </SettingsPage>
  );
}
