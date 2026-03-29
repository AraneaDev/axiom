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
      select: { username: true, displayName: true, email: true },
    }),
    prisma.wikiSpace.findUniqueOrThrow({
      where: { id: context.spaceId },
      select: { name: true, key: true, team: { select: { name: true, slug: true } } },
    }),
  ]);

  let project = undefined;
  if (context.projectId) {
    project = await prisma.project.findUnique({
      where: { id: context.projectId },
      select: { name: true, key: true },
    });
  }

  const templateContext = {
    currentUser: user,
    team: space.team,
    space: { name: space.name, key: space.key },
    project: project ?? undefined,
  };

  return resolveTemplate(body, templateContext);
}
