import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileText, Link as LinkIcon, Replace } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { ApiError } from '@/api/client';
import {
  githubReleaseApi,
  githubRepoKey,
  githubSettingsApi,
  type ReleaseNotesResult,
} from '@/api/github.api';
import { wikiApi } from '@/api/wiki.api';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Select } from '@/components/ui/Dropdown';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { EXTERNAL_LINK, httpsHref } from '@/lib/github-links';

const REPLACEABLE = ['GITHUB_RELEASE_BODY_EXISTS', 'RELEASE_PAGE_EXISTS'];
const NO_DEFAULT = '';

/**
 * The in-app path of the wiki page, only when its URL is on this app's own origin. Anything else
 * (another origin, a non-http scheme, a bad URL) gives no link.
 * @param url - The page URL the server returned.
 */
function pagePath(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.origin === window.location.origin ? u.pathname : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The release notes of a project: the default wiki space, and a form that writes the notes of a
 * tag to a wiki page and the GitHub Release.
 * @param props - The section's inputs.
 * @param props.projectId - The project.
 * @param props.teamId - The team whose wiki spaces can be chosen.
 * @param props.defaultSpaceId - The saved default space, if any.
 */
export function ReleaseNotesSection({
  projectId,
  teamId,
  defaultSpaceId,
}: {
  projectId: string;
  teamId: string | undefined;
  defaultSpaceId: string | null | undefined;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tag, setTag] = useState('');
  const [previousTag, setPreviousTag] = useState('');
  const [spaceId, setSpaceId] = useState(NO_DEFAULT);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ReleaseNotesResult | null>(null);

  const spaces = useQuery({
    queryKey: ['wiki-spaces', teamId],
    queryFn: () => wikiApi.listSpaces(teamId!),
    enabled: !!teamId,
  });
  const options = (spaces.data ?? []).map((s) => ({ value: s.id, label: s.name }));

  const saveDefault = useMutation({
    mutationFn: (id: string) =>
      githubSettingsApi.setReleaseNotesSpace(projectId, id === NO_DEFAULT ? null : id),
    onSuccess: async () => {
      toast.success('Default space saved');
      await queryClient.invalidateQueries({ queryKey: githubRepoKey(projectId) });
    },
  });

  const write = useMutation({
    mutationFn: (replaceBody: boolean) =>
      githubReleaseApi.writeNotes(projectId, {
        tag: tag.trim(),
        ...(previousTag.trim() ? { previousTag: previousTag.trim() } : {}),
        ...(spaceId !== NO_DEFAULT ? { spaceId } : {}),
        ...(replaceBody ? { replaceBody: true } : {}),
      }),
    onSuccess: (data) => setResult(data),
    onSettled: () => setConfirming(false),
  });

  const error = write.error;
  const code = error instanceof ApiError ? error.code : undefined;
  const canReplace = !!code && REPLACEABLE.includes(code);
  const notConnected = code === 'GITHUB_NOT_CONNECTED';
  const pageLink = result ? pagePath(result.pageUrl) : undefined;
  const releaseLink = result ? httpsHref(result.releaseUrl) : undefined;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!tag.trim()) return;
    setResult(null);
    write.reset();
    write.mutate(false);
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-sm font-semibold text-text">Release notes</h2>
        <p className="mt-1 text-xs text-text-tertiary">
          Lists the pull requests merged since the previous tag and their tickets, on a wiki page
          and in the body of the GitHub Release.
        </p>
        <p className="mt-1 text-xs text-text-tertiary">
          Ticket titles and statuses are published to the GitHub Release, which is public when the
          repository is.
        </p>
      </div>
      <div className="w-full max-w-md">
        <Select
          label="Default space"
          placeholder="No default space"
          hint="A space of this team. Release notes go here unless you pick another."
          options={[{ value: NO_DEFAULT, label: 'No default space' }, ...options]}
          value={defaultSpaceId ?? NO_DEFAULT}
          disabled={saveDefault.isPending || spaces.isLoading}
          onChange={(v) => saveDefault.mutate(v as string)}
        />
      </div>
      {saveDefault.isError && (
        <ErrorAlert error={saveDefault.error} fallback="Could not save the default space" />
      )}

      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid max-w-3xl gap-3 sm:grid-cols-3">
          <Input
            label="Tag"
            placeholder="v1.2.0"
            value={tag}
            onChange={(e) => {
              write.reset();
              setTag(e.target.value);
            }}
            autoComplete="off"
          />
          <Input
            label="Previous tag (optional)"
            placeholder="v1.1.0"
            value={previousTag}
            onChange={(e) => {
              write.reset();
              setPreviousTag(e.target.value);
            }}
            autoComplete="off"
          />
          <Select
            label="Space"
            options={[{ value: NO_DEFAULT, label: 'Default space' }, ...options]}
            value={spaceId}
            onChange={(v) => {
              write.reset();
              setSpaceId(v as string);
            }}
          />
        </div>
        <div>
          <Button type="submit" disabled={!tag.trim() || write.isPending}>
            {write.isPending ? <Spinner size="sm" /> : <FileText className="h-4 w-4" />}
            Write release notes
          </Button>
        </div>
      </form>

      {error && !notConnected && <ErrorAlert error={error} fallback="Could not write the notes" />}
      {notConnected && (
        <div className="flex flex-wrap items-center gap-3">
          <ErrorAlert error={error} fallback="Your GitHub account is not connected" />
          <ButtonLink to="/settings/github" variant="outline" size="sm">
            <LinkIcon className="h-4 w-4" /> Connect your GitHub account
          </ButtonLink>
        </div>
      )}
      {canReplace && (
        <div>
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
            <Replace className="h-4 w-4" />
            Replace the existing body
          </Button>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-2 text-sm text-text">
          <p>
            {`${result.pullRequests} pull ${result.pullRequests === 1 ? 'request' : 'requests'} and ${result.tickets} ${result.tickets === 1 ? 'ticket' : 'tickets'} written.`}
          </p>
          {result.draft && (
            <p className="text-xs text-text-secondary">
              The GitHub Release is a draft and stays one.
            </p>
          )}
          {result.truncated && (
            <p className="text-xs text-warning">
              The list was cut short: it is longer than fits in the notes.
            </p>
          )}
          <div className="flex flex-wrap gap-4">
            {pageLink && (
              <Link
                to={pageLink}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                Wiki page
                <FileText className="h-3.5 w-3.5" />
              </Link>
            )}
            {releaseLink && (
              <a
                href={releaseLink}
                {...EXTERNAL_LINK}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                GitHub Release
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => write.mutate(true)}
        loading={write.isPending}
        variant="warning"
        title="Replace the existing body?"
        description={`The body of the GitHub Release ${tag.trim()} is replaced, and so is a hand-written wiki page "Release ${tag.trim()}" when one exists. What was written there is lost.`}
        confirmLabel="Replace"
      />
    </Card>
  );
}
