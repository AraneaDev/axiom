import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, GitBranch, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { githubAppApi } from '@/api/github.api';
import type { GithubAppStatus } from '@/api/github.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { Table, Tbody, Td, Th, TrHead, Thead, Tr } from '@/components/ui/Table';
import { useRunOnce } from '@/hooks/useRunOnce';
import { useAuthStore } from '@/stores/auth.store';

const STATUS_KEY = ['github-app'];

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

function Header({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <Link to="/admin" title="Back to admin">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </Link>
      <div>
        <h1 className="h2">GitHub App</h1>
        <p className="text-sm text-text-secondary mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

function AdminsOnly() {
  return (
    <EmptyState
      icon={<GitBranch />}
      title="Only platform administrators set up GitHub"
      description="Ask an administrator of this instance."
    />
  );
}

/**
 * GitHub's manifest flow takes a form post, not a fetch: the browser has to go there.
 * @param postUrl Where GitHub wants the form posted
 * @param manifest The App manifest, sent as the hidden manifest field
 */
function postManifest(postUrl: string, manifest: unknown) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = postUrl;
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'manifest';
  input.value = JSON.stringify(manifest);
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}

function NotConfigured() {
  const [organization, setOrganization] = useState('');
  const start = useMutation({
    mutationFn: () => githubAppApi.startManifest(organization.trim() || undefined),
    onSuccess: (data) => postManifest(data.postUrl, data.manifest),
  });

  return (
    <Card className="p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-text">Set up the GitHub App</h2>
        <p className="text-xs text-text-tertiary mt-1">
          GitHub asks you to confirm the App, then sends you back here. The App belongs to your own
          GitHub account unless you name an organization.
        </p>
      </div>
      <div className="max-w-sm">
        <Input
          label="GitHub organization (optional)"
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          placeholder="acme-co"
        />
      </div>
      {start.isError && <ErrorBox message={messageOf(start.error, 'Could not start the setup')} />}
      <div>
        <Button onClick={() => start.mutate()} disabled={start.isPending}>
          {start.isPending ? <Spinner size="sm" /> : <Plus className="h-4 w-4" />}
          Create GitHub App
        </Button>
      </div>
    </Card>
  );
}

function Configured({ status }: { status: GithubAppStatus }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const refresh = useMutation({
    mutationFn: githubAppApi.syncInstallations,
    onSuccess: (data) => queryClient.setQueryData(STATUS_KEY, data),
  });
  const forget = useMutation({
    mutationFn: githubAppApi.remove,
    onSuccess: () => {
      setConfirming(false);
      queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-text-tertiary">App</p>
            <p className="text-sm font-semibold text-text">{status.slug}</p>
          </div>
          <div className="flex items-center gap-2">
            {status.htmlUrl && (
              <a href={status.htmlUrl} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm">
                  <ExternalLink className="h-4 w-4" /> View on GitHub
                </Button>
              </a>
            )}
            {status.installUrl && (
              <a href={status.installUrl} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4" /> Install on an account
                </Button>
              </a>
            )}
            <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
              <Trash2 className="h-4 w-4" /> Forget App
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Installations</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
          >
            {refresh.isPending ? <Spinner size="sm" /> : <RefreshCw className="h-4 w-4" />}
            Refresh installations
          </Button>
        </div>
        {refresh.isError && (
          <ErrorBox message={messageOf(refresh.error, 'Could not refresh the installations')} />
        )}
        {status.installations.length === 0 ? (
          <p className="text-sm text-text-secondary">
            The App is not installed anywhere yet. Install it on the account or organization whose
            repositories you want to use.
          </p>
        ) : (
          <Table>
            <Thead>
              <TrHead>
                <Th>Account</Th>
                <Th>State</Th>
              </TrHead>
            </Thead>
            <Tbody>
              {status.installations.map((installation) => (
                <Tr key={installation.id}>
                  <Td>{installation.accountLogin}</Td>
                  <Td>
                    {installation.suspended ? (
                      <Badge variant="warning">Suspended</Badge>
                    ) : (
                      <Badge variant="success">Active</Badge>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      {forget.isError && <ErrorBox message={messageOf(forget.error, 'Could not forget the App')} />}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => forget.mutate()}
        loading={forget.isPending}
        title="Forget the GitHub App?"
        description="Axiom forgets the App and stops using it. It is not deleted on GitHub: remove it there under Settings, Developer settings, GitHub Apps."
        confirmLabel="Forget App"
      />
    </div>
  );
}

/** The admin page: set up the App, see where it is installed. */
export default function GithubAppSettings() {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading, error } = useQuery({
    queryKey: STATUS_KEY,
    queryFn: githubAppApi.status,
    enabled: !!user?.isAdmin,
  });

  if (!user?.isAdmin) return <AdminsOnly />;
  return (
    <div className="flex flex-col gap-6">
      <Header subtitle="One App for the whole instance, installed on the accounts whose repositories you use" />
      {isLoading && <PageLoader />}
      {error && <ErrorBox message={messageOf(error, 'Could not load the GitHub App')} />}
      {data && (data.configured ? <Configured status={data} /> : <NotConfigured />)}
    </div>
  );
}

/** GitHub sends you here after you confirmed the App, with a single-use code. */
export function GithubAppCreated() {
  const user = useAuthStore((s) => s.user);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const code = params.get('code') ?? '';
  const state = params.get('state') ?? '';
  const result = useRunOnce(async () => {
    if (!user?.isAdmin) return null;
    try {
      const data = await githubAppApi.completeManifest(code, state);
      queryClient.setQueryData(STATUS_KEY, data);
      return data;
    } finally {
      // The code is spent, so a reload must not send it again
      navigate('/admin/github/created', { replace: true });
    }
  });

  if (!user?.isAdmin) return <AdminsOnly />;
  return (
    <div className="flex flex-col gap-6">
      <Header subtitle="Finishing the setup" />
      {result.status === 'pending' && <PageLoader />}
      {result.status === 'error' && (
        <>
          <ErrorBox message={messageOf(result.error, 'Could not finish the setup')} />
          <div>
            <Link to="/admin/github">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4" /> Back to GitHub App
              </Button>
            </Link>
          </div>
        </>
      )}
      {result.status === 'success' && result.data && (
        <Card className="p-6 flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-semibold text-text">The App is set up</h2>
            <p className="text-xs text-text-tertiary mt-1">
              Now install it on the account or organization whose repositories you want to use.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {result.data.installUrl && (
              <a href={result.data.installUrl}>
                <Button size="sm">
                  <ExternalLink className="h-4 w-4" /> Install on GitHub
                </Button>
              </a>
            )}
            <Link to="/admin/github">
              <Button variant="outline" size="sm">
                <GitBranch className="h-4 w-4" /> Go to the App
              </Button>
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}

/** GitHub sends you here after an installation: read the installations and go back. */
export function GithubAppInstalled() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const result = useRunOnce(async () => {
    if (!user?.isAdmin) return null;
    const data = await githubAppApi.syncInstallations();
    queryClient.setQueryData(STATUS_KEY, data);
    navigate('/admin/github', { replace: true });
    return data;
  });

  if (!user?.isAdmin) return <AdminsOnly />;
  return (
    <div className="flex flex-col gap-6">
      <Header subtitle="Reading the installations" />
      {result.status !== 'error' && <PageLoader />}
      {result.status === 'error' && (
        <>
          <ErrorBox message={messageOf(result.error, 'Could not read the installations')} />
          <div>
            <Link to="/admin/github">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4" /> Back to GitHub App
              </Button>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
