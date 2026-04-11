import bcrypt from 'bcryptjs';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { broadcastToRoom } from '../../realtime/broadcast';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { logger } from '../../utils/logger';

// ─── Form CRUD ──────────────────────────────────────────────

/**
 *
 * @param projectId
 */
export async function listForms(projectId: string) {
  return prisma.form.findMany({
    where: { projectId },
    include: {
      _count: {
        select: {
          submissions: true,
          pages: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 *
 * @param formId
 * @param projectId
 */
export async function getForm(formId: string, projectId: string) {
  return findOrThrow(
    prisma.form.findFirst({
      where: { id: formId, projectId },
      include: {
        pages: {
          orderBy: { position: 'asc' },
          include: {
            fields: {
              orderBy: { position: 'asc' },
            },
            conditionField: {
              select: { id: true, label: true, type: true },
            },
          },
        },
        _count: { select: { submissions: true } },
      },
    }),
    ERR.FORM_NOT_FOUND,
  );
}

/**
 *
 * @param slug
 */
export async function getPublicForm(slug: string) {
  const form = await prisma.form.findUnique({
    where: { slug },
    include: {
      pages: {
        orderBy: { position: 'asc' },
        include: {
          fields: {
            orderBy: { position: 'asc' },
          },
          conditionField: {
            select: { id: true, label: true, type: true },
          },
        },
      },
    },
  });
  if (!form) throw new AppError(404, ERR.FORM_NOT_FOUND);
  if (form.status !== 'PUBLISHED') throw new AppError(404, ERR.FORM_NOT_FOUND);
  return form;
}

/**
 *
 * @param projectId
 * @param createdById
 * @param data
 * @param data.name
 * @param data.slug
 * @param data.description
 * @param data.authMode
 * @param data.sharedSecret
 * @param data.spamProtection
 * @param data.rateLimitPerHour
 * @param data.successMessage
 * @param data.redirectUrl
 */
export async function createForm(
  projectId: string,
  createdById: string,
  data: {
    name: string;
    slug: string;
    description?: string;
    authMode?: 'PUBLIC' | 'TOKEN_GATED';
    sharedSecret?: string;
    spamProtection?: 'NONE' | 'CAPTCHA' | 'RATE_LIMIT';
    rateLimitPerHour?: number;
    successMessage?: string;
    redirectUrl?: string;
  },
) {
  const existing = await prisma.form.findUnique({ where: { slug: data.slug } });
  if (existing) throw new AppError(409, 'A form with this slug already exists');

  let sharedSecret: string | undefined;
  if (data.sharedSecret) {
    sharedSecret = await bcrypt.hash(data.sharedSecret, 10);
  }

  return prisma.form.create({
    data: {
      projectId,
      createdById,
      name: data.name,
      slug: data.slug,
      description: data.description,
      authMode: data.authMode ?? 'PUBLIC',
      sharedSecret,
      spamProtection: data.spamProtection ?? 'NONE',
      rateLimitPerHour: data.rateLimitPerHour,
      successMessage: data.successMessage,
      redirectUrl: data.redirectUrl,
    },
    include: {
      pages: true,
      _count: { select: { submissions: true } },
    },
  });
}

/**
 *
 * @param formId
 * @param projectId
 * @param data
 * @param data.name
 * @param data.slug
 * @param data.description
 * @param data.authMode
 * @param data.sharedSecret
 * @param data.spamProtection
 * @param data.rateLimitPerHour
 * @param data.successMessage
 * @param data.redirectUrl
 */
export async function updateForm(
  formId: string,
  projectId: string,
  data: {
    name?: string;
    slug?: string;
    description?: string;
    authMode?: 'PUBLIC' | 'TOKEN_GATED';
    sharedSecret?: string;
    spamProtection?: 'NONE' | 'CAPTCHA' | 'RATE_LIMIT';
    rateLimitPerHour?: number;
    successMessage?: string;
    redirectUrl?: string;
  },
) {
  await findOrThrow(
    prisma.form.findFirst({ where: { id: formId, projectId } }),
    ERR.FORM_NOT_FOUND,
  );

  if (data.slug) {
    const existing = await prisma.form.findFirst({
      where: { slug: data.slug, NOT: { id: formId } },
    });
    if (existing) throw new AppError(409, 'A form with this slug already exists');
  }

  let sharedSecret: string | undefined;
  if (data.sharedSecret) {
    sharedSecret = await bcrypt.hash(data.sharedSecret, 10);
  }

  return prisma.form.update({
    where: { id: formId },
    data: {
      ...data,
      sharedSecret: sharedSecret ?? data.sharedSecret,
    },
    include: {
      pages: {
        orderBy: { position: 'asc' },
        include: { fields: { orderBy: { position: 'asc' } } },
      },
      _count: { select: { submissions: true } },
    },
  });
}

/**
 *
 * @param formId
 * @param projectId
 */
export async function deleteForm(formId: string, projectId: string) {
  await findOrThrow(
    prisma.form.findFirst({ where: { id: formId, projectId } }),
    ERR.FORM_NOT_FOUND,
  );
  await prisma.form.delete({ where: { id: formId } });
}

/**
 *
 * @param formId
 * @param projectId
 */
export async function publishForm(formId: string, projectId: string) {
  const form = await findOrThrow(
    prisma.form.findFirst({
      where: { id: formId, projectId },
      include: {
        pages: {
          include: { fields: true },
        },
      },
    }),
    ERR.FORM_NOT_FOUND,
  );

  // Only validate when publishing (not when unpublishing)
  if (form.status !== 'PUBLISHED') {
    if (form.pages.length === 0) {
      throw new AppError(400, 'Form must have at least one page before publishing');
    }

    const allFields = form.pages.flatMap((p) => p.fields);
    const hasTitleMapping = allFields.some((f) => f.issueFieldMapping === 'title');
    if (!hasTitleMapping) {
      throw new AppError(400, "Form must have a field mapped to 'title' before publishing");
    }
  }

  const newStatus = form.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';

  return prisma.form.update({
    where: { id: formId },
    data: { status: newStatus },
    include: {
      pages: {
        orderBy: { position: 'asc' },
        include: { fields: { orderBy: { position: 'asc' } } },
      },
      _count: { select: { submissions: true } },
    },
  });
}

// ─── Page CRUD ──────────────────────────────────────────────

/**
 *
 * @param formId
 * @param data
 * @param data.title
 * @param data.position
 * @param data.conditionFieldId
 * @param data.conditionOperator
 * @param data.conditionValue
 */
export async function createPage(
  formId: string,
  data: {
    title: string;
    position?: number;
    conditionFieldId?: string;
    conditionOperator?: string;
    conditionValue?: string;
  },
) {
  let position = data.position;
  if (position === undefined) {
    const last = await prisma.formPage.findFirst({
      where: { formId },
      orderBy: { position: 'desc' },
    });
    position = last ? last.position + 1 : 0;
  }

  return prisma.formPage.create({
    data: {
      formId,
      title: data.title,
      position,
      conditionFieldId: data.conditionFieldId,
      conditionOperator: data.conditionOperator,
      conditionValue: data.conditionValue,
    },
    include: {
      fields: { orderBy: { position: 'asc' } },
      conditionField: { select: { id: true, label: true, type: true } },
    },
  });
}

/**
 *
 * @param pageId
 * @param data
 * @param data.title
 * @param data.position
 * @param data.conditionFieldId
 * @param data.conditionOperator
 * @param data.conditionValue
 */
export async function updatePage(
  pageId: string,
  data: {
    title?: string;
    position?: number;
    conditionFieldId?: string;
    conditionOperator?: string;
    conditionValue?: string;
  },
) {
  await findOrThrow(prisma.formPage.findUnique({ where: { id: pageId } }), ERR.PAGE_NOT_FOUND);

  return prisma.formPage.update({
    where: { id: pageId },
    data,
    include: {
      fields: { orderBy: { position: 'asc' } },
      conditionField: { select: { id: true, label: true, type: true } },
    },
  });
}

/**
 *
 * @param pageId
 */
export async function deletePage(pageId: string) {
  await findOrThrow(prisma.formPage.findUnique({ where: { id: pageId } }), ERR.PAGE_NOT_FOUND);
  await prisma.formPage.delete({ where: { id: pageId } });
}

/**
 *
 * @param formId
 * @param pageIds
 */
export async function reorderPages(formId: string, pageIds: string[]) {
  await prisma.$transaction(
    pageIds.map((id, index) =>
      prisma.formPage.updateMany({
        where: { id, formId },
        data: { position: index },
      }),
    ),
  );
  return prisma.formPage.findMany({
    where: { formId },
    orderBy: { position: 'asc' },
    include: { fields: { orderBy: { position: 'asc' } } },
  });
}

// ─── Field CRUD ─────────────────────────────────────────────

/**
 *
 * @param pageId
 * @param data
 * @param data.type
 * @param data.label
 * @param data.placeholder
 * @param data.helpText
 * @param data.required
 * @param data.options
 * @param data.issueFieldMapping
 * @param data.validationRules
 * @param data.validationRules.minLength
 * @param data.validationRules.maxLength
 * @param data.validationRules.pattern
 * @param data.position
 */
export async function createField(
  pageId: string,
  data: {
    type:
      | 'TEXT'
      | 'TEXTAREA'
      | 'SELECT'
      | 'MULTISELECT'
      | 'CHECKBOX'
      | 'RADIO'
      | 'DATE'
      | 'FILE'
      | 'HEADING'
      | 'DESCRIPTION';
    label: string;
    placeholder?: string;
    helpText?: string;
    required?: boolean;
    options?: Array<{ label: string; value: string }>;
    issueFieldMapping?: string;
    validationRules?: { minLength?: number; maxLength?: number; pattern?: string };
    position?: number;
  },
) {
  let position = data.position;
  if (position === undefined) {
    const last = await prisma.formField.findFirst({
      where: { formPageId: pageId },
      orderBy: { position: 'desc' },
    });
    position = last ? last.position + 1 : 0;
  }

  return prisma.formField.create({
    data: {
      formPageId: pageId,
      type: data.type,
      label: data.label,
      placeholder: data.placeholder,
      helpText: data.helpText,
      required: data.required ?? false,
      options: data.options ? data.options : undefined,
      issueFieldMapping: data.issueFieldMapping,
      validationRules: data.validationRules ? data.validationRules : undefined,
      position,
    },
  });
}

/**
 *
 * @param fieldId
 * @param data
 * @param data.type
 * @param data.label
 * @param data.placeholder
 * @param data.helpText
 * @param data.required
 * @param data.options
 * @param data.issueFieldMapping
 * @param data.validationRules
 * @param data.validationRules.minLength
 * @param data.validationRules.maxLength
 * @param data.validationRules.pattern
 * @param data.position
 */
export async function updateField(
  fieldId: string,
  data: {
    type?:
      | 'TEXT'
      | 'TEXTAREA'
      | 'SELECT'
      | 'MULTISELECT'
      | 'CHECKBOX'
      | 'RADIO'
      | 'DATE'
      | 'FILE'
      | 'HEADING'
      | 'DESCRIPTION';
    label?: string;
    placeholder?: string;
    helpText?: string;
    required?: boolean;
    options?: Array<{ label: string; value: string }>;
    issueFieldMapping?: string;
    validationRules?: { minLength?: number; maxLength?: number; pattern?: string };
    position?: number;
  },
) {
  await findOrThrow(prisma.formField.findUnique({ where: { id: fieldId } }), ERR.FIELD_NOT_FOUND);

  return prisma.formField.update({
    where: { id: fieldId },
    data: {
      ...data,
      options: data.options !== undefined ? data.options : undefined,
      validationRules: data.validationRules !== undefined ? data.validationRules : undefined,
    },
  });
}

/**
 *
 * @param fieldId
 */
export async function deleteField(fieldId: string) {
  await findOrThrow(prisma.formField.findUnique({ where: { id: fieldId } }), ERR.FIELD_NOT_FOUND);
  await prisma.formField.delete({ where: { id: fieldId } });
}

/**
 *
 * @param formId
 * @param fieldIds
 */
export async function reorderFields(formId: string, fieldIds: string[]) {
  // Verify fields belong to this form (via pages)
  const pages = await prisma.formPage.findMany({ where: { formId }, select: { id: true } });
  const pageIds = pages.map((p) => p.id);

  await prisma.$transaction(
    fieldIds.map((id, index) =>
      prisma.formField.updateMany({
        where: { id, formPageId: { in: pageIds } },
        data: { position: index },
      }),
    ),
  );

  return prisma.formField.findMany({
    where: { formPageId: { in: pageIds } },
    orderBy: { position: 'asc' },
  });
}

// ─── Public Submission ───────────────────────────────────────

/**
 *
 * @param slug
 * @param data
 * @param submitterEmail
 * @param submitterName
 * @param submitterIp
 * @param honeypot
 */
export async function submitForm(
  slug: string,
  data: Record<string, unknown>,
  submitterEmail: string | undefined,
  submitterName: string | undefined,
  submitterIp: string,
  honeypot?: string,
) {
  const form = await getPublicForm(slug);

  // Honeypot spam detection
  const isSpam = Boolean(honeypot && honeypot.length > 0);

  const submission = await prisma.formSubmission.create({
    data: {
      formId: form.id,
      projectId: form.projectId,
      status: isSpam ? 'SPAM' : 'PENDING',
      data: data as object,
      submitterEmail,
      submitterName,
      submitterIp,
    },
  });

  if (!isSpam) {
    broadcastToRoom(`project:${form.projectId}`, {
      type: 'form:submission:created',
      projectId: form.projectId,
      submissionId: submission.id,
      formId: form.id,
    });
  }

  logger.info(`Form submission created: ${submission.id} formId=${form.id} spam=${isSpam}`);

  return submission;
}

/**
 *
 * @param slug
 * @param secret
 */
export async function verifyFormAccess(slug: string, secret?: string) {
  const form = await prisma.form.findUnique({ where: { slug } });
  if (!form) throw new AppError(404, ERR.FORM_NOT_FOUND);
  if (form.status !== 'PUBLISHED') throw new AppError(404, ERR.FORM_NOT_FOUND);

  if (form.authMode === 'TOKEN_GATED') {
    if (!secret) throw new AppError(401, 'Access token required');
    if (!form.sharedSecret) throw new AppError(500, 'Form is misconfigured');
    const valid = await bcrypt.compare(secret, form.sharedSecret);
    if (!valid) throw new AppError(401, 'Invalid access token');
  }

  return { authorized: true, authMode: form.authMode };
}
