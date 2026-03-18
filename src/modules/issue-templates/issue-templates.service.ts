import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

export interface IssueTemplate {
  id: string;
  name: string;
  type: 'TASK' | 'BUG' | 'STORY' | 'EPIC';
  title: string;
  body: string;
  labels: string[];
  assigneeId?: string;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

async function getTemplates(projectId: string): Promise<IssueTemplate[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { issueTemplates: true },
  });
  if (!project) throw new AppError(404, 'Project not found');

  if (!project.issueTemplates) return [];
  return project.issueTemplates as unknown as IssueTemplate[];
}

async function saveTemplates(projectId: string, templates: IssueTemplate[]) {
  await prisma.project.update({
    where: { id: projectId },
    data: {
      issueTemplates: templates as unknown as import('@prisma/client').Prisma.InputJsonValue,
    },
  });
}

/**
 * Create an issue template for a project.
 * @param projectId
 * @param data
 * @param data.name
 * @param data.type
 * @param data.title
 * @param data.body
 * @param data.labels
 * @param data.assigneeId
 */
export async function createTemplate(
  projectId: string,
  data: {
    name: string;
    type: 'TASK' | 'BUG' | 'STORY' | 'EPIC';
    title: string;
    body: string;
    labels?: string[];
    assigneeId?: string;
  },
) {
  const templates = await getTemplates(projectId);

  const existing = templates.find((t) => t.name === data.name);
  if (existing) throw new AppError(409, 'Template with this name already exists');

  const template: IssueTemplate = {
    id: generateId(),
    name: data.name,
    type: data.type,
    title: data.title,
    body: data.body,
    labels: data.labels ?? [],
    assigneeId: data.assigneeId,
  };

  templates.push(template);
  await saveTemplates(projectId, templates);
  return template;
}

/**
 * List all issue templates for a project.
 * @param projectId
 */
export async function listTemplates(projectId: string) {
  return getTemplates(projectId);
}

/**
 * Get a single issue template by ID.
 * @param projectId
 * @param templateId
 */
export async function getTemplate(projectId: string, templateId: string) {
  const templates = await getTemplates(projectId);
  const template = templates.find((t) => t.id === templateId);
  if (!template) throw new AppError(404, 'Template not found');
  return template;
}

/**
 * Update an issue template.
 * @param projectId
 * @param templateId
 * @param data
 * @param data.name
 * @param data.type
 * @param data.title
 * @param data.body
 * @param data.labels
 * @param data.assigneeId
 */
export async function updateTemplate(
  projectId: string,
  templateId: string,
  data: {
    name?: string;
    type?: 'TASK' | 'BUG' | 'STORY' | 'EPIC';
    title?: string;
    body?: string;
    labels?: string[];
    assigneeId?: string;
  },
) {
  const templates = await getTemplates(projectId);
  const index = templates.findIndex((t) => t.id === templateId);
  if (index === -1) throw new AppError(404, 'Template not found');

  // Check name conflict
  if (data.name && data.name !== templates[index].name) {
    const conflict = templates.find((t) => t.name === data.name);
    if (conflict) throw new AppError(409, 'Template with this name already exists');
  }

  templates[index] = {
    ...templates[index],
    ...data,
  };

  await saveTemplates(projectId, templates);
  return templates[index];
}

/**
 * Delete an issue template by ID.
 * @param projectId
 * @param templateId
 */
export async function deleteTemplate(projectId: string, templateId: string) {
  const templates = await getTemplates(projectId);
  const index = templates.findIndex((t) => t.id === templateId);
  if (index === -1) throw new AppError(404, 'Template not found');

  templates.splice(index, 1);
  await saveTemplates(projectId, templates);
}
