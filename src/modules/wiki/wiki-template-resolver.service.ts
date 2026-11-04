import { prisma } from '../../config/database';
import { resolveTemplate } from '../../lib/query-engine';
import { assertTemplateAccess } from '../../middleware/rbac';

interface ResolveContext {
  teamId: string;
  spaceId: string;
  projectId?: string;
  userId: string;
}

/**
 *
 * @param body
 * @param context
 */
export async function resolveWikiTemplate(body: string, context: ResolveContext): Promise<string> {
  const [user, space] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: context.userId },
      // No email: a template's output is page content anyone with access reads
      select: { username: true, displayName: true },
    }),
    prisma.wikiSpace.findUniqueOrThrow({
      where: { id: context.spaceId },
      select: { name: true, slug: true, team: { select: { name: true, slug: true } } },
    }),
  ]);

  let project = undefined;
  if (context.projectId) {
    project = await prisma.project.findUnique({
      where: { id: context.projectId },
      select: { name: true, prefix: true },
    });
  }

  const templateContext = {
    currentUser: user,
    team: space.team,
    space: { name: space.name, slug: space.slug },
    project: project ?? undefined,
  };

  return resolveTemplate(body, templateContext);
}

/**
 * The body a new page gets from a template. The template must be readable by the user, by the rule
 * of the template routes, as its text becomes page content they read.
 * @param templateId - The template
 * @param spaceId - The space the page goes in, whose names the variables read
 * @param userId - Who creates the page
 * @throws {AppError} 404 for no such template, 403 for one the user may not read
 */
export async function bodyFromTemplate(
  templateId: string,
  spaceId: string,
  userId: string,
): Promise<string> {
  await assertTemplateAccess(userId, templateId);
  const template = await prisma.pageTemplate.findUniqueOrThrow({
    where: { id: templateId },
    select: { body: true },
  });
  return resolveWikiTemplate(template.body, { teamId: '', spaceId, userId });
}
