import { useQuery } from '@tanstack/react-query';
import { Bot, Plug, Plus } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link } from 'react-router';

import { usersApi } from '@/api/users.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CopyInput } from '@/components/ui/CopyInput';
import { Input } from '@/components/ui/Input';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { Spinner } from '@/components/ui/Spinner';
import { Toggle } from '@/components/ui/Toggle';
import { useFormError } from '@/hooks/useFormError';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { AGENT_CLIENTS, agentSnippets, type AgentClient } from '@/lib/agent-snippets';
import { SCOPE_GROUPS, toggleScope } from '@/lib/token-scopes';

const CONNECT_SCOPES: string[] = SCOPE_GROUPS.filter((g) => g.area !== 'admin').flatMap((g) =>
  'readOnly' in g ? [`${g.area}:read`] : [`${g.area}:write`],
);

/** Create a token for Claude Code or Codex and show the command or config that uses it. */
export default function ConnectAgent() {
  const [client, setClient] = useState<AgentClient>('claude-code');
  const [name, setName] = useState('Claude Code');
  const [scopes, setScopes] = useState<string[]>([...CONNECT_SCOPES]);
  const [days, setDays] = useState('90');
  const [created, setCreated] = useState<{ token: string; client: AgentClient } | null>(null);
  const { error, setError } = useFormError();

  const { data: tokens } = useQuery({ queryKey: ['apiTokens'], queryFn: usersApi.listApiTokens });

  const createMutation = useMutationWithToast(
    () =>
      usersApi.createApiToken({
        name: name.trim(),
        scopes,
        expiresInDays: Number(days),
      }),
    {
      successMessage: 'Token created',
      errorMessage: null,
      invalidateKeys: [['apiTokens']],
      onSuccess: (data) => {
        if (!data.token) {
          // Nothing to copy: a command without the token would look like it works
          setError('The server did not return a token. Try again.');
          return;
        }
        setError('');
        setCreated({ token: data.token, client });
      },
      onError: (err) => setError(err.message || 'Failed to create token'),
    },
  );

  function pickClient(id: AgentClient) {
    setClient(id);
    setName(AGENT_CLIENTS.find((c) => c.id === id)?.tokenName ?? '');
  }

  const daysValid = Number.isInteger(Number(days)) && Number(days) >= 1;
  const snippets = created
    ? agentSnippets(created.client, window.location.origin, created.token)
    : [];

  return (
    <SettingsPage
      title="Connect an agent"
      description="Create a token and get the command that connects Claude Code or Codex"
      icon={Plug}
      helpTitle="Connecting an agent"
      helpItems={[
        {
          title: 'The name',
          description: 'The name of the token is the label shown next to what the agent does.',
        },
        {
          title: 'Token security',
          description: 'The token is shown once. Copy the command before you leave this page.',
        },
      ]}
      actions={
        <Link to="/settings/tokens">
          <Button size="sm" variant="secondary">
            <Bot className="h-4 w-4" /> All API tokens
          </Button>
        </Link>
      }
    >
      {created ? (
        <Card className="p-5 mb-6 space-y-3">
          <p className="text-sm font-medium text-success">
            Token created. Copy it now, you won't see it again.
          </p>
          <CopyInput label="token" value={created.token} />
          {snippets.map((s) => (
            <div key={s.label}>
              <p className="text-xs text-text-secondary mb-1">{s.label}</p>
              <CopyInput label={s.label} value={s.value} />
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setCreated(null)}>
            <Plus className="h-4 w-4" /> Connect another
          </Button>
        </Card>
      ) : (
        <Card className="p-5 mb-6 space-y-4">
          {error && (
            <div className="rounded-md bg-danger-light border border-danger/20 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
          <div role="group" aria-label="Client" className="flex gap-2">
            {AGENT_CLIENTS.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={client === c.id ? 'primary' : 'secondary'}
                aria-pressed={client === c.id}
                onClick={() => pickClient(c.id)}
              >
                <Plug className="h-4 w-4" /> {c.label}
              </Button>
            ))}
          </div>
          <Input
            id="agentTokenName"
            label="Token name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            id="agentTokenDays"
            label="Expires in (days)"
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-2">
            <span className="text-sm font-medium">Scopes</span>
            <span className="text-xs text-text-secondary text-center">Read</span>
            <span className="text-xs text-text-secondary text-center">Write</span>
            {SCOPE_GROUPS.map((group) => {
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
          <Button
            size="sm"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !name.trim() || !scopes.length || !daysValid}
          >
            {createMutation.isPending ? (
              <Spinner size="sm" />
            ) : (
              <>
                <Plug className="h-4 w-4" /> Create token
              </>
            )}
          </Button>
        </Card>
      )}
      {tokens && tokens.length > 0 && (
        <p className="text-xs text-text-secondary">
          You have {tokens.length} API {tokens.length === 1 ? 'token' : 'tokens'}.{' '}
          <Link to="/settings/tokens" className="underline">
            Manage them
          </Link>
          .
        </p>
      )}
    </SettingsPage>
  );
}
