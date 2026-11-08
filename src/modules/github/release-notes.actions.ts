import { z } from 'zod';

import { projectAction, spaceAccess } from '../../actions/authorize';
import type { ActionContext } from '../../actions/define';
import { defineAction } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';
import { scopeAllows } from '../../middleware/token-scopes';

import { assertRefName } from './github-actions.helpers';
import { writeReleaseNotes } from './release-notes.service';

const PATH = '/api/projects/:projectId/github';

const projectTarget = z.object({ projectId: z.string() });

// The target names the space only when the request does: the action checks edit on it, and the
// handler checks the project's setting the same way before anything else happens
const notesTarget = projectTarget.extend({
  spaceId: z
    .string()
    .min(1)
    .optional()
    .describe("The wiki space; default: the project's release notes space"),
});
type NotesTarget = z.infer<typeof notesTarget>;

const isRefName = (name: string) => {
  try {
    assertRefName(name);
    return true;
  } catch {
    return false;
  }
};
const tagName = z.string().min(1).max(200).refine(isRefName, 'Not a valid tag name');

// Release notes describe the project's tickets, so they need issue edit on the project
const issueEdit = projectAction<NotesTarget>('issue:edit', (i) => i.projectId);
const spaceEdit = spaceAccess<{ spaceId: string }>('EDIT', (i) => i.spaceId);

/**
 * Issue edit on the project, wiki:write for a token, then edit on the space the request names.
 * @param ctx Who asks
 * @param input The target
 */
async function writeNotesAccess(ctx: ActionContext, input: NotesTarget): Promise<void> {
  await issueEdit(ctx, input);
  // The notes are a wiki page as well: a token needs wiki:write beside the github:write of the
  // area, checked here as attachments check the scope of their parent
  if (ctx.scopes && !scopeAllows(ctx.scopes, 'wiki', 'write')) {
    throw new AppError(
      403,
      'This API token needs the wiki:write scope as well to write release notes',
      'SCOPE',
    );
  }
  if (input.spaceId !== undefined) await spaceEdit(ctx, { spaceId: input.spaceId });
}

registerActions([
  defineAction({
    name: 'githubRelease.writeNotes',
    area: 'github',
    kind: 'write',
    // Replacing a body a person wrote on GitHub loses it
    destructiveWhen: (input) => input.replaceBody === true,
    summary:
      'Write the release notes of a tag (the pull requests merged since the previous tag and their ' +
      'tickets) to a wiki page and the body of the GitHub release, as your own GitHub account. A ' +
      'release body or page Axiom did not write, or that was edited since, is only replaced with ' +
      'replaceBody. A token needs wiki:write as well.',
    target: notesTarget,
    input: notesTarget.extend({
      tag: tagName.describe('The tag of the release, such as v1.2.0'),
      previousTag: tagName
        .optional()
        .describe('The tag to compare with; default: the newest earlier published release'),
      replaceBody: z
        .boolean()
        .optional()
        .describe('Replace a release body Axiom did not write; waits for approval for a token'),
    }),
    output: z.looseObject({
      pageUrl: z.string(),
      releaseUrl: z.string(),
      pullRequests: z.number(),
      tickets: z.number(),
      truncated: z.boolean(),
    }),
    preview: (_ctx, { projectId, tag, replaceBody }) =>
      previews.githubReleaseNotes(projectId, tag, replaceBody === true),
    rest: { method: 'POST', path: `${PATH}/release-notes` },
    authorize: writeNotesAccess,
    handler: async (ctx, input) => writeReleaseNotes(ctx, input),
  }),
]);
