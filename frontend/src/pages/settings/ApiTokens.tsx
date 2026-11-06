import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Coins, KeyRound, Plug, Plus, Trash2, Copy, X } from 'lucide-react';
import { Fragment, useState } from 'react';

import { usersApi } from '@/api/users.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { Skeleton, ListSkeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { Toggle } from '@/components/ui/Toggle';
import { useFormError } from '@/hooks/useFormError';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { DEFAULT_SCOPES, SCOPE_GROUPS, toggleScope } from '@/lib/token-scopes';
import { formatDate } from '@/lib/utils';

/**
 *
 */
export default function ApiTokens() {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([...DEFAULT_SCOPES]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const { error, setError } = useFormError();
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const {
    data: tokens,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: ['apiTokens'],
    queryFn: usersApi.listApiTokens,
  });

  const createMutation = useMutationWithToast(() => usersApi.createApiToken({ name, scopes }), {
    successMessage: 'Token created',
    errorMessage: null,
    invalidateKeys: [['apiTokens']],
    onSuccess: (data) => {
      setNewToken(data.token ?? null);
      setShowForm(false);
      setName('');
      setScopes([...DEFAULT_SCOPES]);
    },
    onError: (err) => setError(err.message || 'Failed to create token'),
  });

  const deleteMutation = useMutationWithToast(
    (tokenId: string) => usersApi.deleteApiToken(tokenId),
    { successMessage: 'Token revoked', invalidateKeys: [['apiTokens']] },
  );

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
      description="Create and manage tokens for API and MCP access"
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
            'Each area has a read and a write scope, and write includes read. Reading your profile and notifications needs read on issues or wiki. Calls that delete, change who can reach something, or manage orgs, teams, members, projects, permissions and tokens wait until you approve them in Agent approvals, whatever the scopes.',
        },
      ]}
      actions={
        <div className="flex gap-2">
          <ButtonLink to="/settings/connect-agent" size="sm" variant="secondary">
            <Plug className="h-4 w-4" /> Connect an agent
          </ButtonLink>
          <Button
            size="sm"
            onClick={() => {
              setShowForm(!showForm);
              setNewToken(null);
            }}
          >
            <Plus className="h-4 w-4" /> New Token
          </Button>
        </div>
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
        <Card className="p-5 mb-6">
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
            <div>
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-2">
                <span className="text-sm font-medium">Scopes</span>
                <span className="text-xs text-text-secondary text-center">Read</span>
                <span className="text-xs text-text-secondary text-center">Write</span>
                {SCOPE_GROUPS.map((group) => {
                  const { area, label, description } = group;
                  const canWrite = scopes.includes(`${area}:write`);
                  const canRead = canWrite || scopes.includes(`${area}:read`);
                  return (
                    <Fragment key={area}>
                      <div className="min-w-0">
                        <p className="text-sm">{label}</p>
                        <p className="text-xs text-text-secondary">{description}</p>
                      </div>
                      <Toggle
                        aria-label={`${label} read`}
                        checked={canRead}
                        disabled={canWrite}
                        onChange={(on) => setScopes(toggleScope(scopes, area, 'read', on))}
                      />
                      {'readOnly' in group ? (
                        <span />
                      ) : (
                        <Toggle
                          aria-label={`${label} write`}
                          checked={canWrite}
                          onChange={(on) => setScopes(toggleScope(scopes, area, 'write', on))}
                        />
                      )}
                    </Fragment>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-text-secondary">
                The read and search tools need Search; what they return also needs read on Issues,
                Wiki or Files. A write scope includes reading. Tokens can't manage orgs, teams,
                members, projects, permissions or tokens.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !name || scopes.length === 0}
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
              <div className="w-48 shrink-0 min-w-0">
                <p className="text-sm font-medium break-words">{t.name}</p>
                <p className="text-xs text-text-secondary font-mono">{t.prefix}...</p>
              </div>
              <div className="flex flex-1 min-w-0 gap-1 flex-wrap">
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
