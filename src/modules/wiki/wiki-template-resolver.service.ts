import { prisma } from '../../config/database';
import { resolveTemplate } from '../../lib/query-engine';

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
