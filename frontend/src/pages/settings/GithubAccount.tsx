import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, GitBranch, Link as LinkIcon, Unlink } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { githubAccountApi, githubAppApi } from '@/api/github.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { useRunOnce } from '@/hooks/useRunOnce';

const ACCOUNT_KEY = ['github-account'];

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md bg-danger-light border border-danger/20 px-4 py-3 text-sm text-danger"
    >
      {message}
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="h2">GitHub</h1>
      <p className="text-sm text-text-secondary mt-0.5">
        Connect your own GitHub account so Axiom acts on GitHub as you
      </p>
    </div>
  );
}

/** Your GitHub account: connect it, or disconnect it. */
export default function GithubAccount() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const app = useQuery({ queryKey: ['github-app'], queryFn: githubAppApi.status });
  const account = useQuery({ queryKey: ACCOUNT_KEY, queryFn: githubAccountApi.get });
  const connect = useMutation({
    mutationFn: githubAccountApi.startConnect,
    onSuccess: (data) => window.location.assign(data.authorizeUrl),
  });
  const disconnect = useMutation({
    mutationFn: githubAccountApi.disconnect,
    onSuccess: (data) => {
      setConfirming(false);
      queryClient.setQueryData(ACCOUNT_KEY, data);
    },
  });

  if (app.isLoading || account.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <PageLoader />
      </div>
    );
  }
  const loadError = app.error ?? account.error;

  return (
    <div className="flex flex-col gap-6">
      <Header />
      {loadError && (
        <ErrorBox message={messageOf(loadError, 'Could not load your GitHub account')} />
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
            <ErrorBox message={messageOf(connect.error, 'Could not start connecting')} />
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
        <ErrorBox message={messageOf(disconnect.error, 'Could not disconnect')} />
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => disconnect.mutate()}
        loading={disconnect.isPending}
        title="Disconnect your GitHub account?"
        description="GitHub revokes the token Axiom holds for you. You can connect again at any time."
        confirmLabel="Disconnect"
      />
    </div>
  );
}

/** GitHub sends you here after you authorized the App, with a single-use code. */
export function GithubAccountCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const code = params.get('code') ?? '';
  const state = params.get('state') ?? '';
  const result = useRunOnce(async () => {
    try {
      const data = await githubAccountApi.completeConnect(code, state);
      queryClient.setQueryData(ACCOUNT_KEY, data);
      navigate('/settings/github', { replace: true });
      return data;
    } catch (error) {
      // The code is spent, so a reload must not send it again
      navigate('/settings/github/callback', { replace: true });
      throw error;
    }
  });

  return (
    <div className="flex flex-col gap-6">
      <Header />
      {result.status !== 'error' && <PageLoader />}
      {result.status === 'error' && (
        <>
          <ErrorBox message={messageOf(result.error, 'Could not connect your GitHub account')} />
          <div>
            <Link to="/settings/github">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4" /> Back to GitHub
              </Button>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
