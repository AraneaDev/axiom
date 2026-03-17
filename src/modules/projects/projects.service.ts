import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

const DEFAULT_COLUMNS = [
  { name: 'Backlog', position: 0, isDefault: true, isDone: false },
  { name: 'To Do', position: 1, isDefault: false, isDone: false },
  { name: 'In Progress', position: 2, isDefault: false, isDone: false },
  { name: 'In Review', position: 3, isDefault: false, isDone: false },
  { name: 'Done', position: 4, isDefault: false, isDone: true },
];

export async function createProject(teamId: string, data: {
  name: string;
  slug: string;
  description?: string;
  prefix: string;
}) {
  const existing = await prisma.project.findUnique({
    where: { teamId_slug: { teamId, slug: data.slug } },
  });
  if (existing) throw new AppError(409, 'Project slug already taken');

  const prefixExists = await prisma.project.findUnique({
    where: { teamId_prefix: { teamId, prefix: data.prefix } },
  });
  if (prefixExists) throw new AppError(409, 'Project prefix already taken');

  return prisma.project.create({
    data: {
      teamId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      prefix: data.prefix,
      columns: {
        createMany: { data: DEFAULT_COLUMNS },
      },
    },
    include: { columns: { orderBy: { position: 'asc' } } },
  });
}

export async function getProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      columns: { orderBy: { position: 'asc' } },
      labels: true,
      _count: { select: { issues: true } },
    },
  });
  if (!project) throw new AppError(404, 'Project not found');
  return project;
}

export async function listProjects(teamId: string) {
  return prisma.project.findMany({
    where: { teamId },
    include: { _count: { select: { issues: true } } },
    orderBy: { name: 'asc' },
  });
}

export async function updateProject(projectId: string, data: { name?: string; description?: string }) {
  return prisma.project.update({ where: { id: projectId }, data });
}

export async function deleteProject(projectId: string) {
  await prisma.project.delete({ where: { id: projectId } });
}
