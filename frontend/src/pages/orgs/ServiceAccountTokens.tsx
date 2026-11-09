import { useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound, RefreshCw, Trash2, X } from 'lucide-react';
import { Fragment, useState } from 'react';

import {
  serviceAccountError,
  serviceAccountsApi,
  type NewServiceAccountToken,
  type ServiceAccountDetail,
  type ServiceAccountToken,
} from '@/api/service-accounts.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CopyInput } from '@/components/ui/CopyInput';
import { Select } from '@/components/ui/Dropdown';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Toggle } from '@/components/ui/Toggle';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { AGENT_SCOPE_GROUPS, CONNECT_SCOPES, connectSnippets } from '@/lib/agent-snippets';
import { toggleScope } from '@/lib/token-scopes';
import { cn, formatDate, formatRelative } from '@/lib/utils';

/** The lifetimes a bot's token may get, in days: a bot's token always ends, within a year */
const BOT_TOKEN_EXPIRY_DAYS = [30, 90, 180, 365] as const;
const DEFAULT_EXPIRY_DAYS = 90;

/** How close to its end a token's expiry starts to warn */
const WARN_WITHIN_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Whether a token ends within 14 days, or has ended.
 * @param expiresAt - When it stops working, or null for never
 */
function endsSoon(expiresAt: string | null): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() - Date.now() < WARN_WITHIN_MS;
}

/**
 * A bot's tokens: listed by prefix, made, rotated and revoked by an org admin or an owner. A new
 * token's raw value shows once, with the Claude Code and Codex snippets filled in, and is gone
 * once dismissed or on the next visit.
 * @param props - The bot
 * @param props.bot - The bot, as its page reads it
 */
export function ServiceAccountTokens({ bot }: { bot: ServiceAccountDetail }) {
  const queryClient = useQueryClient();
  const suspended = bot.status === 'SUSPENDED';
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<{
    kind: 'rotate' | 'revoke';
    token: ServiceAccountToken;
  } | null>(null);
  // The raw token lives only here: never in the query cache, so a refetch or reload drops it
  const [revealed, setRevealed] = useState<{
    token: NewServiceAccountToken;
    kind: 'created' | 'rotated';
  } | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['service-account', bot.id] });
    void queryClient.invalidateQueries({ queryKey: ['service-accounts'] });
  };

  const rotate = useMutationWithToast(
    (tokenId: string) => serviceAccountsApi.rotateToken(bot.id, tokenId),
    {
      successMessage: 'Token rotated',
      errorMessage: null,
      // The answer holds the raw token: the panel's state is its only home
      gcTime: 0,
      onSuccess: (next) => {
        setConfirm(null);
        setRevealed({ token: next, kind: 'rotated' });
        refresh();
      },
      // Closed, so the reason shows on the panel; the list may have changed meanwhile
      onError: () => {
        setConfirm(null);
        refresh();
      },
    },
  );
  const revoke = useMutationWithToast(
    (tokenId: string) => serviceAccountsApi.revokeToken(bot.id, tokenId),
    {
      successMessage: 'Token revoked',
      errorMessage: null,
      onSuccess: () => {
        setConfirm(null);
        refresh();
      },
      onError: () => {
        setConfirm(null);
        refresh();
      },
    },
  );
  const actionError = rotate.error ?? revoke.error;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">Tokens</h2>
        <Button
          size="xs"
          disabled={suspended}
          title={suspended ? 'A suspended bot gets no new tokens' : undefined}
          onClick={() => setCreating(true)}
        >
          <KeyRound className="h-3.5 w-3.5" /> New token
        </Button>
      </div>

      {revealed && (
        <RevealedToken
          created={revealed.token}
          kind={revealed.kind}
          server={`axiom-${bot.username}`}
          onDone={() => {
            setRevealed(null);
            // Nothing keeps the raw value once it is put away
            rotate.reset();
          }}
        />
      )}
      {actionError && (
        <div className="mb-3">
          <ErrorAlert error={new Error(serviceAccountError(actionError))} fallback="" />
        </div>
      )}

      {bot.tokens.length === 0 ? (
        <p className="text-sm text-text-tertiary">No tokens yet.</p>
      ) : (
        <ul className="divide-y divide-border-light">
          {bot.tokens.map((t) => (
            <TokenRow
              key={t.id}
              token={t}
              suspended={suspended}
              onRotate={() => {
                revoke.reset();
                rotate.reset();
                setConfirm({ kind: 'rotate', token: t });
              }}
              onRevoke={() => {
                revoke.reset();
                rotate.reset();
                setConfirm({ kind: 'revoke', token: t });
              }}
            />
          ))}
        </ul>
      )}

      {creating && (
        <CreateTokenModal
          bot={bot}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            setRevealed({ token: created, kind: 'created' });
            refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={confirm?.kind === 'rotate'}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && rotate.mutate(confirm.token.id)}
        loading={rotate.isPending}
        variant="warning"
        title={`Rotate ${confirm?.token.name ?? 'token'}?`}
        description="You get a new token with the same name and scopes. The old one works for 7 more days at most, so whatever uses it can move to the new one."
        confirmLabel="Rotate"
      />
      <ConfirmDialog
        open={confirm?.kind === 'revoke'}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && revoke.mutate(confirm.token.id)}
        loading={revoke.isPending}
        title={`Revoke ${confirm?.token.name ?? 'token'}?`}
        description="It stops working at once. Whatever uses it gets refused from its next call."
        confirmLabel="Revoke"
      />
    </Card>
  );
}

function TokenRow({
  token: t,
  suspended,
  onRotate,
  onRevoke,
}: {
  token: ServiceAccountToken;
  suspended: boolean;
  onRotate: () => void;
  onRevoke: () => void;
}) {
  const warn = endsSoon(t.expiresAt);
  return (
    <li data-testid={`token-${t.id}`} className="flex flex-wrap items-start gap-3 py-3 text-sm">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-text">{t.name}</span>
          <code className="text-xs text-text-tertiary">{t.prefix}...</code>
          {t.rotatedAt && (
            <Badge variant="outline" size="sm">
              Rotated {formatDate(t.rotatedAt)}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {t.scopes.map((s) => (
            <Badge key={s} variant="outline" size="sm">
              {s}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
          <span className={cn(warn ? 'font-medium text-warning' : 'text-text-tertiary')}>
            {t.expiresAt ? `Expires ${formatDate(t.expiresAt)}` : 'No expiry'}
          </span>
          <span className="text-text-tertiary">
            {t.lastUsedAt ? `Last used ${formatRelative(t.lastUsedAt)}` : 'Never used'}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        {/* A token is rotated once: its replacement is the one to rotate next */}
        {!t.rotatedAt && (
          <Button
            variant="ghost"
            size="xs"
            disabled={suspended}
            aria-label={`Rotate ${t.name}`}
            title={suspended ? 'A suspended bot gets no new tokens' : 'Rotate'}
            onClick={onRotate}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Rotate
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          aria-label={`Revoke ${t.name}`}
          title="Revoke"
          onClick={onRevoke}
        >
          <Trash2 className="h-3.5 w-3.5" /> Revoke
        </Button>
      </div>
    </li>
  );
}

/**
 * The raw token, the one time it is shown, with the snippets that connect an agent with it.
 * @param props - The new token
 * @param props.created - The token as the create or rotate call answered it
 * @param props.kind - Whether it was made or a rotation
 * @param props.server - The name the snippets give the server
 * @param props.onDone - Hide it for good
 */
function RevealedToken({
  created,
  kind,
  server,
  onDone,
}: {
  created: NewServiceAccountToken;
  kind: 'created' | 'rotated';
  server: string;
  onDone: () => void;
}) {
  const snippets = connectSnippets(window.location.origin, created.token, server);
  return (
    <div
      data-testid="new-token"
      className="mb-4 space-y-3 rounded-md border border-success/30 bg-success-light p-4"
    >
      <p className="text-sm font-medium text-success">
        Token {created.name} {kind}. Copy it now, you won't see it again.
      </p>
      <CopyInput label="token" value={created.token} />
      {snippets.map((s) => (
        <div key={s.label}>
          <p className="mb-1 text-xs text-text-secondary">{s.label}</p>
          <CopyInput label={s.label} value={s.value} />
        </div>
      ))}
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={onDone}>
          <Check className="h-3.5 w-3.5" /> Done
        </Button>
      </div>
    </div>
  );
}

/**
 * Make a token for a bot: a name, scopes as on the connect page without admin, and a lifetime of
 * at most a year.
 * @param props - The bot and what follows
 * @param props.bot - The bot
 * @param props.onClose - Close without making one
 * @param props.onCreated - Called with the new token, raw value included
 */
function CreateTokenModal({
  bot,
  onClose,
  onCreated,
}: {
  bot: ServiceAccountDetail;
  onClose: () => void;
  onCreated: (created: NewServiceAccountToken) => void;
}) {
  const [name, setName] = useState('Agent');
  const [scopes, setScopes] = useState<string[]>([...CONNECT_SCOPES]);
  const [days, setDays] = useState(String(DEFAULT_EXPIRY_DAYS));
  const create = useMutationWithToast(
    () =>
      serviceAccountsApi.createToken(bot.id, {
        name: name.trim(),
        scopes,
        expiresInDays: Number(days),
      }),
    {
      successMessage: 'Token created',
      errorMessage: null,
      // The answer holds the raw token: the panel's state is its only home
      gcTime: 0,
      onSuccess: onCreated,
    },
  );

  return (
    <Modal open onClose={onClose} title={`New token for ${bot.displayName}`} size="lg">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Input
          id="bot-token-name"
          label="Token name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
        <Select
          label="Expires in"
          value={days}
          onChange={(v) => setDays(v as string)}
          options={BOT_TOKEN_EXPIRY_DAYS.map((d) => ({ value: String(d), label: `${d} days` }))}
        />
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-2">
          <span className="text-sm font-medium">Scopes</span>
          <span className="text-center text-xs text-text-secondary">Read</span>
          <span className="text-center text-xs text-text-secondary">Write</span>
          {AGENT_SCOPE_GROUPS.map((group) => {
            const { area, label } = group;
            const canWrite = scopes.includes(`${area}:write`);
            const canRead = canWrite || scopes.includes(`${area}:read`);
            return (
              <Fragment key={area}>
                <p className="text-sm">{label}</p>
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
        <p className="text-xs text-text-tertiary">
          A bot&apos;s token has no admin scope. Its rights are those of the teams and spaces it is
          in.
        </p>
        {create.error && (
          <ErrorAlert error={new Error(serviceAccountError(create.error))} fallback="" />
        )}
        <ModalFooter>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={!name.trim() || scopes.length === 0 || create.isPending}
          >
            <KeyRound className="h-3.5 w-3.5" /> Create token
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
