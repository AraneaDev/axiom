import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, GitBranch, Link as LinkIcon, Unlink } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';

import {
  GITHUB_ACCOUNT_KEY,
  GITHUB_APP_KEY,
  githubAccountApi,
  githubAppApi,
} from '@/api/github.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { useRunOnce } from '@/hooks/useRunOnce';

const HELP_ITEMS = [
  {
    title: 'What connecting does',
    description: 'GitHub asks you to authorize the App, and Axiom then acts on GitHub as you.',
  },
  {
    title: 'Disconnecting',
    description: 'GitHub revokes the token Axiom holds for you. You can connect again at any time.',
  },
];

/** Your GitHub account: connect it, or disconnect it. */
export default function GithubAccount() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const app = useQuery({ queryKey: GITHUB_APP_KEY, queryFn: githubAppApi.status });
  const account = useQuery({ queryKey: GITHUB_ACCOUNT_KEY, queryFn: githubAccountApi.get });
  const connect = useMutation({
    mutationFn: githubAccountApi.startConnect,
    onSuccess: (data) => window.location.assign(data.authorizeUrl),
  });
  const disconnect = useMutation({
    mutationFn: githubAccountApi.disconnect,
    onSuccess: (data) => queryClient.setQueryData(GITHUB_ACCOUNT_KEY, data),
    // A failure shows below, not behind the dialog
    onSettled: () => setConfirming(false),
  });

  const loadError = app.error ?? account.error;

  return (
    <SettingsPage
      title="GitHub"
      description="Connect your own GitHub account so Axiom acts on GitHub as you"
      icon={GitBranch}
      helpTitle="Your GitHub account"
      helpItems={HELP_ITEMS}
    >
      <div className="flex flex-col gap-6">
        {(app.isLoading || account.isLoading) && <PageLoader />}
        {loadError && (
          <ErrorAlert error={loadError} fallback="Could not load your GitHub account" />
        )}
        {app.data && !app.data.configured && (
          <EmptyState
            card
            icon={<GitBranch />}
            title="An administrator has not set up GitHub yet"
            description="Once the GitHub App exists you can connect your account here."
          />
        )}
        {app.data?.configured && account.data && !account.data.connected && (
          <Card className="p-6 flex flex-col gap-4">
            <div>
              <h2 className="text-sm font-semibold text-text">Not connected</h2>
              <p className="text-xs text-text-tertiary mt-1">
                GitHub asks you to authorize the App, then sends you back here.
              </p>
            </div>
            {connect.isError && (
              <ErrorAlert error={connect.error} fallback="Could not start connecting" />
            )}
            <div>
              <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
                {connect.isPending ? <Spinner size="sm" /> : <LinkIcon className="h-4 w-4" />}
                Connect GitHub
              </Button>
            </div>
          </Card>
        )}
        {app.data?.configured && account.data?.connected && (
          <Card className="p-6 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-text-tertiary">Connected as</p>
              <p className="text-sm font-semibold text-text">{account.data.login}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
              <Unlink className="h-4 w-4" /> Disconnect
            </Button>
          </Card>
        )}
        {disconnect.isError && (
          <ErrorAlert error={disconnect.error} fallback="Could not disconnect" />
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => disconnect.mutate()}
        loading={disconnect.isPending}
        title="Disconnect your GitHub account?"
        description="GitHub revokes the token Axiom holds for you. You can connect again at any time."
        confirmLabel="Disconnect"
      />
    </SettingsPage>
  );
}

/** GitHub sends you here after you authorized the App, with a single-use code. */
export function GithubAccountCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Read once: the URL loses them before the request goes out
  const [spent] = useState(() => ({ code: params.get('code'), state: params.get('state') }));
  const result = useRunOnce(async () => {
    // The code is single-use, so a reload must not find it
    navigate('/settings/github/callback', { replace: true });
    // Let the router commit the new URL before the code goes out
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!spent.code || !spent.state) return null;
    const data = await githubAccountApi.completeConnect(spent.code, spent.state);
    queryClient.setQueryData(GITHUB_ACCOUNT_KEY, data);
    navigate('/settings/github', { replace: true });
    return data;
  });

  if (!spent.code || !spent.state) return <Navigate to="/settings/github" replace />;
  return (
    <SettingsPage
      title="GitHub"
      icon={GitBranch}
      helpTitle="Your GitHub account"
      helpItems={HELP_ITEMS}
    >
      {result.status !== 'error' && <PageLoader />}
      {result.status === 'error' && (
        <div className="flex flex-col gap-6">
          <ErrorAlert error={result.error} fallback="Could not connect your GitHub account" />
          <div>
            <Link to="/settings/github">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4" /> Back to GitHub
              </Button>
            </Link>
          </div>
        </div>
      )}
    </SettingsPage>
  );
}
