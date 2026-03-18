import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';

interface SearchParams {
  q: string;
  type: 'issues' | 'wiki' | 'all';
  teamId?: string;
  projectId?: string;
  limit: number;
  offset: number;
}

/**
 *
 * @param params
 */
export async function search(params: SearchParams) {
  const results: { type: string; items: Record<string, unknown>[] }[] = [];

  if (params.type === 'issues' || params.type === 'all') {
    const where: Prisma.IssueWhereInput = {
      OR: [
        { title: { contains: params.q, mode: 'insensitive' } },
        { body: { contains: params.q, mode: 'insensitive' } },
      ],
      ...(params.projectId ? { projectId: params.projectId } : {}),
    };

    const issues = await prisma.issue.findMany({
      where,
      include: {
        project: {
          select: {
            prefix: true,
            slug: true,
            team: { select: { slug: true, org: { select: { slug: true } } } },
          },
        },
        assignee: { select: { id: true, username: true, displayName: true } },
        labels: true,
      },
      take: params.limit,
      skip: params.offset,
      orderBy: { updatedAt: 'desc' },
    });

    results.push({
      type: 'issues',
      items: issues.map((i) => ({
        ...i,
        key: `${i.project.prefix}-${i.number}`,
        url: `/${i.project.team.org.slug}/${i.project.team.slug}/${i.project.slug}/issues/${i.number}`,
      })),
    });
  }

  if (params.type === 'wiki' || params.type === 'all') {
    const where: Prisma.PageWhereInput = {
      OR: [
        { title: { contains: params.q, mode: 'insensitive' } },
        { body: { contains: params.q, mode: 'insensitive' } },
      ],
    };

    const pages = await prisma.page.findMany({
      where,
      include: {
        space: {
          select: {
            id: true,
            name: true,
            slug: true,
            team: { select: { slug: true, org: { select: { slug: true } } } },
          },
        },
      },
      take: params.limit,
      skip: params.offset,
      orderBy: { updatedAt: 'desc' },
    });

    results.push({
      type: 'wiki',
      items: pages.map((p) => ({
        ...p,
        url: `/${p.space.team.org.slug}/${p.space.team.slug}/wiki/${p.space.slug}/${p.slug}`,
      })),
    });
  }

  return results;
}
