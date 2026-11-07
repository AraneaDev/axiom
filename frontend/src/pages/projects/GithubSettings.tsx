import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ExternalLink,
  GitPullRequest,
  Link as LinkIcon,
  RefreshCw,
  Unlink,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';

import {
  GITHUB_ACCOUNT_KEY,
  GITHUB_APP_KEY,
  githubAccountApi,
  githubAppApi,
  githubHealthKey,
  githubRepoApi,
  githubRepoKey,
  type GithubLinkHealth,
  type GithubRepoLink,
} from '@/api/github.api';
import { Button } from '@/components/ui/Button';
import { buttonClasses } from '@/components/ui/button-styles';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { Input } from '@/components/ui/Input';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { Table, TableContainer, Tbody, Td, Th, Thead, TrHead, Tr } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useProjectContext } from '@/hooks/useProjectContext';
import { EXTERNAL_LINK, httpsHref, unlinkPreview } from '@/lib/github-links';
import { formatRelative } from '@/lib/utils';

const HELP_ITEMS = [
  {
    title: 'Who can link',
    description:
      'You need to be an admin of the team, and an admin of the repository on GitHub. Axiom checks that with your connected GitHub account.',
  },
  {
    title: 'What linking shows',
    description:
      'Everyone who can read the project sees the branches, pull requests, reviews and failed checks that name an issue key.',
  },
  {
    title: 'Keeping up',
    description:
      'GitHub sends events as they happen, and Axiom reads the repository again every 15 minutes in case one was missed.',
  },
];

/**
 * The link to follow that a refusal carries in its details, such as the App's install page
 * @param error
 */
function installUrlOf(error: unknown): string | undefined {
  const details = (error as { details?: Record<string, unknown> } | null)?.details;
  return httpsHref(typeof details?.installUrl === 'string' ? details.installUrl : undefined);
}

/**
 * The cooldown's refusal, with the time after which the next run is allowed
 * @param error
 */
function withRetryTime(error: unknown): unknown {
  const e = error as { code?: string; details?: Record<string, unknown>; message?: string } | null;
  const wait = e?.details?.retryAfter;
  if (e?.code !== 'GITHUB_RECONCILE_COOLDOWN' || typeof wait !== 'number') return error;
  return new Error(
    `${e.message ?? 'Reconciled a moment ago.'} Try again in ${wait} ${wait === 1 ? 'second' : 'seconds'}.`,
  );
}

// How long after a reconcile started the health is read again
const REFRESH_AFTER_START_MS = 3000;

function InstallLink({ href }: { href: string }) {
  return (
    <a href={href} {...EXTERNAL_LINK} className={buttonClasses('outline', 'sm')}>
      <ExternalLink className="h-4 w-4" /> Install the GitHub App
    </a>
  );
}

function Warning({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-light px-4 py-3 text-sm text-warning">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

function LinkForm({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [repo, setRepo] = useState('');
  const app = useQuery({ queryKey: GITHUB_APP_KEY, queryFn: githubAppApi.status });
  const account = useQuery({ queryKey: GITHUB_ACCOUNT_KEY, queryFn: githubAccountApi.get });
  const link = useMutation({
    mutationFn: () => githubRepoApi.link(projectId, repo.trim()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: githubRepoKey(projectId) });
      await queryClient.invalidateQueries({ queryKey: githubHealthKey(projectId) });
      await queryClient.invalidateQueries({ queryKey: ['issue-development', projectId] });
    },
  });

  const notSetUp = app.data && !app.data.configured;
  const noAccount = account.data && !account.data.connected;
  const noInstall = app.data?.configured && app.data.installations.length === 0;
  const installUrl = httpsHref(app.data?.installUrl);
  const refusalInstallUrl = installUrlOf(link.error);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (repo.trim()) link.mutate();
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-sm font-semibold text-text">Link a repository</h2>
        <p className="mt-1 text-xs text-text-tertiary">
          One repository per project. You need admin rights on it on GitHub.
        </p>
      </div>
      {notSetUp && (
        <Warning>
          An administrator has not set up GitHub yet, so no repository can be linked.
        </Warning>
      )}
      {noAccount && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-text-secondary">
            Linking checks your rights on GitHub, so your own GitHub account has to be connected.
          </p>
          <ButtonLink to="/settings/github" variant="outline" size="sm">
            <LinkIcon className="h-4 w-4" /> Connect your GitHub account
          </ButtonLink>
        </div>
      )}
      {noInstall && installUrl && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-text-secondary">
            The GitHub App is not installed on any account yet.
          </p>
          <InstallLink href={installUrl} />
        </div>
      )}
      <form onSubmit={submit} className="flex items-end gap-3">
        <div className="w-full max-w-md">
          <Input
            label="Repository"
            placeholder="owner/name"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            autoComplete="off"
          />
        </div>
        <Button
          type="submit"
          disabled={!repo.trim() || link.isPending || !!notSetUp || !!noAccount}
        >
          {link.isPending ? <Spinner size="sm" /> : <LinkIcon className="h-4 w-4" />}
          Link repository
        </Button>
      </form>
      {link.isError && (
        <div className="flex flex-col items-start gap-3">
          <ErrorAlert error={link.error} fallback="Could not link the repository" />
          {refusalInstallUrl && <InstallLink href={refusalInstallUrl} />}
        </div>
      )}
    </Card>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-text-tertiary">{label}</dt>
          <dd className="text-text">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function HealthCard({ health }: { health: GithubLinkHealth }) {
  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="text-sm font-semibold text-text">Health</h2>
      {health.appSecretUnreadable && (
        <Warning>
          The GitHub App secret key cannot be read, so Axiom cannot act as the App. An administrator
          has to check the server's secret key.
        </Warning>
      )}
      {!health.appInstalled && (
        <Warning>
          {health.installationRemoved
            ? 'The GitHub App is no longer installed for this repository. Axiom stops reading it until you install the App again.'
            : 'The GitHub App is not installed for this repository, so Axiom cannot read it.'}
        </Warning>
      )}
      {!health.reconcileComplete && health.reconcileIncompleteReason && (
        <Warning>{`The last reconcile is incomplete: ${health.reconcileIncompleteReason}`}</Warning>
      )}
      {health.installationSuspended && (
        <Warning>
          The installation is suspended on GitHub, so no events arrive until it is resumed.
        </Warning>
      )}
      <Facts
        rows={[
          [
            'Last delivery',
            health.lastDeliveryAt ? formatRelative(health.lastDeliveryAt) : 'None yet',
          ],
          [
            'Last reconcile',
            health.lastReconciledAt ? formatRelative(health.lastReconciledAt) : 'None yet',
          ],
        ]}
      />
      {health.lastReconcileError && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-text-tertiary">Reconcile error</p>
          <p className="rounded-md bg-danger-light px-3 py-2 text-sm text-danger break-words">
            {health.lastReconcileError}
          </p>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-text-tertiary">Failed deliveries</h3>
        {health.recentFailures.length === 0 ? (
          <p className="text-sm text-text-secondary">No failed deliveries recently.</p>
        ) : (
          <TableContainer>
            <Table>
              <Thead>
                <TrHead>
                  <Th>Event</Th>
                  <Th>Error</Th>
                  <Th>Attempts</Th>
                  <Th>Received</Th>
                </TrHead>
              </Thead>
              <Tbody>
                {health.recentFailures.map((f) => (
                  <Tr key={f.deliveryId}>
                    <Td>{f.event}</Td>
                    <Td className="break-words">{f.error ?? 'Unknown'}</Td>
                    <Td>{f.attempts}</Td>
                    <Td>{formatRelative(f.receivedAt)}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableContainer>
        )}
      </div>
    </Card>
  );
}

function LinkedView({
  projectId,
  project,
  link,
}: {
  projectId: string;
  project: { prefix: string; name: string };
  link: GithubRepoLink;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const health = useQuery({
    queryKey: githubHealthKey(projectId),
    queryFn: () => githubRepoApi.health(projectId),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: githubHealthKey(projectId) });
    await queryClient.invalidateQueries({ queryKey: ['issue-development', projectId] });
  };
  const reconcile = useMutation({
    mutationFn: () => githubRepoApi.reconcile(projectId),
    onSuccess: () => {
      // The run goes on after the answer: health shows its result once it has finished, through
      // the realtime event, the next refetch, or this look a moment later
      toast.success('Reconcile started');
      window.setTimeout(() => void refresh(), REFRESH_AFTER_START_MS);
    },
  });
  const unlink = useMutation({
    mutationFn: () => githubRepoApi.unlink(projectId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: githubRepoKey(projectId) });
      await refresh();
    },
    onSettled: () => setConfirming(false),
  });
  const href = httpsHref(link.htmlUrl);

  return (
    <>
      <Card className="flex items-center justify-between gap-4 p-6">
        <div className="min-w-0">
          <p className="text-xs text-text-tertiary">Linked repository</p>
          {href ? (
            <a
              href={href}
              {...EXTERNAL_LINK}
              className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
            >
              {link.repoFullName}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <p className="text-sm font-semibold text-text">{link.repoFullName}</p>
          )}
          <p className="mt-1 text-xs text-text-secondary">
            Default branch {link.defaultBranch}
            {link.linkedBy ? `, linked by ${link.linkedBy.displayName}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => reconcile.mutate()}
            disabled={reconcile.isPending}
          >
            {reconcile.isPending ? <Spinner size="sm" /> : <RefreshCw className="h-4 w-4" />}
            Reconcile now
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
            <Unlink className="h-4 w-4" />
            Unlink
          </Button>
        </div>
      </Card>
      {reconcile.isError && (
        <ErrorAlert
          error={withRetryTime(reconcile.error)}
          fallback="Could not read the repository"
        />
      )}
      {unlink.isError && (
        <ErrorAlert error={unlink.error} fallback="Could not unlink the repository" />
      )}
      {health.isLoading && <PageLoader />}
      {health.error && <ErrorAlert error={health.error} fallback="Could not load the health" />}
      {health.data && <HealthCard health={health.data} />}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => unlink.mutate()}
        loading={unlink.isPending}
        title="Unlink this repository?"
        description={unlinkPreview(link.repoFullName, project, link.linkedIssueCount)}
        confirmLabel="Unlink"
      />
    </>
  );
}

/** The GitHub settings of a project: link one repository, see how the link is doing, unlink it. */
export default function GithubSettings() {
  const { currentProject } = useProjectContext();
  const projectId = currentProject?.id;
  const repo = useQuery({
    queryKey: githubRepoKey(projectId),
    queryFn: () => githubRepoApi.get(projectId!),
    enabled: !!projectId,
  });
  // Only an unlinked project needs the health for the unreadable-secret warning
  const health = useQuery({
    queryKey: githubHealthKey(projectId),
    queryFn: () => githubRepoApi.health(projectId!),
    enabled: !!projectId && repo.data === null,
  });

  return (
    <SettingsPage
      title="GitHub"
      description="Show the branches, pull requests and checks of one repository on your issues"
      icon={GitPullRequest}
      helpTitle="Linking a repository"
      helpItems={HELP_ITEMS}
    >
      <div className="flex flex-col gap-6">
        {(repo.isLoading || !projectId) && <PageLoader />}
        {repo.error && <ErrorAlert error={repo.error} fallback="Could not load the GitHub link" />}
        {projectId && repo.data === null && (
          <>
            {health.data?.appSecretUnreadable && (
              <Warning>
                The GitHub App secret key cannot be read, so linking will fail. An administrator has
                to check the server's secret key.
              </Warning>
            )}
            <LinkForm projectId={projectId} />
          </>
        )}
        {projectId && repo.data && (
          <LinkedView
            projectId={projectId}
            project={{
              prefix: currentProject?.prefix ?? '',
              name: currentProject?.name ?? 'this project',
            }}
            link={repo.data}
          />
        )}
      </div>
    </SettingsPage>
  );
}
