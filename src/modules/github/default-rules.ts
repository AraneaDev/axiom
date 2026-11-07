// The rules a project gets when it links a GitHub repository: a PR moves the ticket to review,
// a merge moves it to done, a failing check says so. They are ordinary automation rules, made
// through the rule service, so the team can edit or delete them.
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { createRule } from '../automation/automation.service';
import type { AutomationAction, AutomationTrigger } from '../automation/automation.service';

type DefaultRule = {
  name: string;
  trigger: AutomationTrigger;
  condition?: string;
  actions: AutomationAction[];
};

// `done` is the derived field that reads the column's own flag, so a renamed or a later done
// column keeps its tickets where they are, whatever the columns are called
const NOT_DONE = 'done = false';

async function defaultRules(projectId: string): Promise<DefaultRule[]> {
  const columns = await prisma.boardColumn.findMany({
    where: { projectId },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, isDone: true },
  });
  const inReview = columns.find((column) => column.name.trim().toLowerCase() === 'in review');
  const done = columns.filter((column) => column.isDone);
  const rules: DefaultRule[] = [];
  if (inReview) {
    // An issue that is done stays done when a pull request opens on it
    rules.push({
      name: 'GitHub: PR opened moves to In review',
      trigger: 'pr:opened',
      condition: NOT_DONE,
      actions: [{ type: 'set_status', columnId: inReview.id }],
    });
  }
  // A ticket already done, in whichever done column, is left where it is
  rules.push({
    name: 'GitHub: PR merged moves to done',
    trigger: 'pr:merged',
    condition: NOT_DONE,
    actions: [
      ...(done.length ? [{ type: 'set_status' as const, columnId: done[0].id }] : []),
      { type: 'add_comment', body: 'Merged in {{github.pr.url}}' },
    ],
  });
  rules.push({
    name: 'GitHub: comment when checks fail',
    trigger: 'checks:failed',
    actions: [
      {
        type: 'add_comment',
        body: 'Checks failed on {{github.pr.url}} at {{github.checks.headSha}}: {{github.checks.failedNames}}',
      },
    ],
  });
  return rules;
}

/**
 * Makes the default GitHub rules of a project through the rule service, so its validation
 * applies. A rule whose name the project already has is left alone.
 * @param projectId The project
 * @param created Where the names are put as they are made, so a caller sees them after a failure
 * @returns The names of the rules it created
 */
export async function createDefaultGithubRules(
  projectId: string,
  created: string[] = [],
): Promise<string[]> {
  const have = new Set(
    (await prisma.automationRule.findMany({ where: { projectId }, select: { name: true } })).map(
      (rule) => rule.name,
    ),
  );
  for (const rule of await defaultRules(projectId)) {
    if (have.has(rule.name)) continue;
    await createRule(projectId, rule);
    created.push(rule.name);
  }
  return created;
}

// Null when another caller had the link's turn; else the names of the rules made. A failure
// takes the mark back only when no rule was made: a rule made before it may be deleted by the
// team, and must not come back.
async function claimDefaultRules(repoLinkId: string): Promise<string[] | null> {
  const claim = await prisma.githubRepoLink.updateMany({
    where: { id: repoLinkId, defaultRulesCreatedAt: null },
    data: { defaultRulesCreatedAt: new Date() },
  });
  if (claim.count === 0) return null;
  const created: string[] = [];
  try {
    const link = await prisma.githubRepoLink.findUniqueOrThrow({
      where: { id: repoLinkId },
      select: { projectId: true },
    });
    await createDefaultGithubRules(link.projectId, created);
    return created;
  } catch (err) {
    if (created.length === 0) {
      await prisma.githubRepoLink
        .updateMany({ where: { id: repoLinkId }, data: { defaultRulesCreatedAt: null } })
        .catch(() => undefined);
    } else {
      logger.warn('default github rules made in part', { repoLinkId, made: created.length });
    }
    throw err;
  }
}

/**
 * Makes the default rules of a link, once: the link is marked first with one conditional update,
 * so two callers never both make them and a rule the team deletes later never returns.
 * @param repoLinkId The link
 * @returns The names of the rules created, none when the link had its turn already
 */
export async function applyDefaultGithubRules(repoLinkId: string): Promise<string[]> {
  return (await claimDefaultRules(repoLinkId)) ?? [];
}

/**
 * Gives the links made before default rules existed theirs. A link that fails is logged and
 * left for the next run.
 * @returns How many links this call claimed and served
 */
export async function ensureDefaultGithubRules(): Promise<number> {
  const links = await prisma.githubRepoLink.findMany({
    where: { defaultRulesCreatedAt: null },
    select: { id: true, projectId: true },
  });
  let done = 0;
  for (const link of links) {
    try {
      if ((await claimDefaultRules(link.id)) !== null) done++;
    } catch (err) {
      logger.warn('default github rules not created', {
        projectId: link.projectId,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }
  return done;
}
