import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ApiError } = vi.hoisted(() => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
      public code?: string,
    ) {
      super(message);
    }
  },
}));
const release = vi.hoisted(() => ({ writeNotes: vi.fn() }));
const settings = vi.hoisted(() => ({ setReleaseNotesSpace: vi.fn() }));
const wiki = vi.hoisted(() => ({ listSpaces: vi.fn() }));

vi.mock('@/api/github.api', () => ({
  githubRepoKey: (id: string) => ['github-repo', id],
  githubReleaseApi: release,
  githubSettingsApi: settings,
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/api/client', () => ({ ApiError }));
vi.mock('@/api/wiki.api', () => ({ wikiApi: wiki }));

import { ReleaseNotesSection } from './ReleaseNotesSection';

function show(defaultSpaceId: string | null = null) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ReleaseNotesSection projectId="p1" teamId="t1" defaultSpaceId={defaultSpaceId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const done = {
  pageUrl: 'https://axiom.invalid/acme/core/wiki/docs/release-v1-2-0',
  releaseUrl: 'https://github.com/acme-labs/widget/releases/tag/v1.2.0',
  pullRequests: 4,
  tickets: 3,
  truncated: false,
};

async function write(tag = 'v1.2.0') {
  await userEvent.type(await screen.findByLabelText('Tag'), tag);
  await userEvent.click(screen.getByRole('button', { name: 'Write release notes' }));
}

describe('ReleaseNotesSection', () => {
  beforeEach(() => {
    Object.values(release).forEach((m) => m.mockReset());
    Object.values(settings).forEach((m) => m.mockReset());
    wiki.listSpaces.mockReset();
    wiki.listSpaces.mockResolvedValue([
      { id: 's1', name: 'Docs', slug: 'docs', teamId: 't1' },
      { id: 's2', name: 'Releases', slug: 'releases', teamId: 't1' },
    ]);
  });

  it('saves the default space you choose', async () => {
    settings.setReleaseNotesSpace.mockResolvedValue({
      repoFullName: 'a/b',
      releaseNotesSpaceId: 's2',
    });
    show();
    await userEvent.click(await screen.findByLabelText('Default space'));
    await userEvent.click(await screen.findByRole('button', { name: 'Releases' }));
    await waitFor(() => expect(settings.setReleaseNotesSpace).toHaveBeenCalledWith('p1', 's2'));
  });

  it('links to the page and the Release after writing', async () => {
    release.writeNotes.mockResolvedValue(done);
    show('s1');
    await write();
    expect(release.writeNotes).toHaveBeenCalledWith('p1', { tag: 'v1.2.0' });
    const page = await screen.findByRole('link', { name: /wiki page/i });
    expect(page).toHaveAttribute('href', done.pageUrl);
    const gh = screen.getByRole('link', { name: /github release/i });
    expect(gh).toHaveAttribute('href', done.releaseUrl);
    expect(gh).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('says when the list was cut short', async () => {
    release.writeNotes.mockResolvedValue({ ...done, truncated: true });
    show('s1');
    await write();
    expect(await screen.findByText(/cut short/i)).toBeInTheDocument();
  });

  it('offers to replace the body after a 409, behind a confirm, and resends with replaceBody', async () => {
    release.writeNotes
      .mockRejectedValueOnce(
        new ApiError(409, 'The release has a body', 'GITHUB_RELEASE_BODY_EXISTS'),
      )
      .mockResolvedValueOnce(done);
    show('s1');
    await write();
    await userEvent.click(await screen.findByRole('button', { name: 'Replace the existing body' }));
    expect(release.writeNotes).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/hand-written wiki page/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));
    await waitFor(() =>
      expect(release.writeNotes).toHaveBeenLastCalledWith('p1', {
        tag: 'v1.2.0',
        replaceBody: true,
      }),
    );
    expect(await screen.findByRole('link', { name: /wiki page/i })).toBeInTheDocument();
  });

  it('also offers the replace for an existing release page', async () => {
    release.writeNotes.mockRejectedValueOnce(
      new ApiError(409, 'Page exists', 'RELEASE_PAGE_EXISTS'),
    );
    show('s1');
    await write();
    expect(
      await screen.findByRole('button', { name: 'Replace the existing body' }),
    ).toBeInTheDocument();
  });

  it.each([
    [400, 'RELEASE_NO_CHANGES', 'Nothing merged since the previous tag'],
    [400, 'RELEASE_PREVIOUS_TAG_REQUIRED', 'Name the previous tag'],
    [400, 'RELEASE_NOTES_SPACE_REQUIRED', 'Choose a space'],
    [404, 'GITHUB_TAG_NOT_FOUND', 'No tag v9'],
  ])('shows the message of %s %s', async (status, code, message) => {
    release.writeNotes.mockRejectedValue(new ApiError(status, message, code));
    show('s1');
    await write();
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('button', { name: 'Replace the existing body' })).toBeNull();
  });

  it('links to your GitHub settings when no account is connected', async () => {
    release.writeNotes.mockRejectedValue(
      new ApiError(409, 'Not connected', 'GITHUB_NOT_CONNECTED'),
    );
    show('s1');
    await write();
    expect(
      await screen.findByRole('link', { name: /connect your github account/i }),
    ).toHaveAttribute('href', '/settings/github');
  });
});
