import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, GitBranch, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import { GITHUB_APP_KEY, githubAppApi } from '@/api/github.api';
import type { GithubAppStatus } from '@/api/github.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { buttonClasses } from '@/components/ui/button-styles';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { Input } from '@/components/ui/Input';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { Table, Tbody, Td, Th, TrHead, Thead, Tr } from '@/components/ui/Table';
import { useRunOnce } from '@/hooks/useRunOnce';
import { useAuthStore } from '@/stores/auth.store';

function Header({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <ButtonLink variant="ghost" size="sm" to="/admin">
        <ArrowLeft className="h-4 w-4" /> Back to admin
      </ButtonLink>
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
      {start.isError && <ErrorAlert error={start.error} fallback="Could not start the setup" />}
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
    onSuccess: (data) => queryClient.setQueryData(GITHUB_APP_KEY, data),
  });
  const forget = useMutation({
    mutationFn: githubAppApi.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: GITHUB_APP_KEY }),
    // A failure shows below, not behind the dialog
    onSettled: () => setConfirming(false),
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
              <a
                href={status.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonClasses('outline', 'sm')}
              >
                <ExternalLink className="h-4 w-4" /> View on GitHub
              </a>
            )}
            {status.installUrl && (
              <a
                href={status.installUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonClasses('outline', 'sm')}
              >
                <Plus className="h-4 w-4" /> Install on an account
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
          <ErrorAlert error={refresh.error} fallback="Could not refresh the installations" />
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

      {forget.isError && <ErrorAlert error={forget.error} fallback="Could not forget the App" />}
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
    queryKey: GITHUB_APP_KEY,
    queryFn: githubAppApi.status,
    enabled: !!user?.isAdmin,
  });

  if (!user?.isAdmin) return <AdminsOnly />;
  return (
    <div className="flex flex-col gap-6">
      <Header subtitle="One App for the whole instance, installed on the accounts whose repositories you use" />
      {isLoading && <PageLoader />}
      {error && <ErrorAlert error={error} fallback="Could not load the GitHub App" />}
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
  // Read once: the URL loses them before the request goes out
  const [spent] = useState(() => ({ code: params.get('code'), state: params.get('state') }));
  const result = useRunOnce(async () => {
    // The code is single-use, so a reload must not find it
    navigate('/admin/github/created', { replace: true });
    // Let the router commit the new URL before the code goes out
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!user?.isAdmin || !spent.code || !spent.state) return null;
    const data = await githubAppApi.completeManifest(spent.code, spent.state);
    queryClient.setQueryData(GITHUB_APP_KEY, data);
    return data;
  });

  if (!spent.code || !spent.state) return <Navigate to="/admin/github" replace />;
  if (!user?.isAdmin) return <AdminsOnly />;
  return (
    <div className="flex flex-col gap-6">
      <Header subtitle="Finishing the setup" />
      {result.status === 'pending' && <PageLoader />}
      {result.status === 'error' && (
        <>
          <ErrorAlert error={result.error} fallback="Could not finish the setup" />
          <div>
            <ButtonLink variant="outline" size="sm" to="/admin/github">
              <ArrowLeft className="h-4 w-4" /> Back to GitHub App
            </ButtonLink>
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
              <a href={result.data.installUrl} className={buttonClasses('primary', 'sm')}>
                <ExternalLink className="h-4 w-4" /> Install on GitHub
              </a>
            )}
            <ButtonLink variant="outline" size="sm" to="/admin/github">
              <GitBranch className="h-4 w-4" /> Go to the App
            </ButtonLink>
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
    queryClient.setQueryData(GITHUB_APP_KEY, data);
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
          <ErrorAlert error={result.error} fallback="Could not read the installations" />
          <div>
            <ButtonLink variant="outline" size="sm" to="/admin/github">
              <ArrowLeft className="h-4 w-4" /> Back to GitHub App
            </ButtonLink>
          </div>
        </>
      )}
    </div>
  );
}
