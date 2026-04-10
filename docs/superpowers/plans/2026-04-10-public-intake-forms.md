# Public Intake Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a form builder for project admins to design multi-page forms with branching logic, publish them via public URLs, and manage submissions through a moderation queue.

**Architecture:** New `forms` and `intake` backend modules. `Form`/`FormPage`/`FormField` models for the builder. `FormSubmission` for the queue. Public routes bypass auth with spam protection. Approval creates an issue from mapped fields.

**Tech Stack:** Prisma 7, Express 5, Zod 4, React 19, TanStack Query, native HTML5 drag-and-drop, Lucide icons, CSS variable tokens.

**Spec:** `docs/superpowers/specs/2026-04-10-intake-forms-approvals-roadmap-design.md` (Section 1)

---

## File Structure

### Backend
```
prisma/schema.prisma                              — Add Form, FormPage, FormField, FormSubmission + enums
src/modules/forms/forms.routes.ts                  — Authenticated form CRUD routes
src/modules/forms/forms.controller.ts              — Form/page/field request handling
src/modules/forms/forms.service.ts                 — Form CRUD business logic
src/modules/forms/forms.validation.ts              — Zod schemas
src/modules/forms/forms.test.ts                    — Integration tests
src/modules/forms/public-forms.routes.ts           — Public (no auth) form routes
src/modules/forms/public-forms.controller.ts       — Public form submission handling
src/modules/intake/intake.routes.ts                — Intake queue routes
src/modules/intake/intake.controller.ts            — Queue management
src/modules/intake/intake.service.ts               — Submission review, issue creation
src/modules/intake/intake.validation.ts            — Validation schemas
src/modules/intake/intake.test.ts                  — Integration tests
```

### Frontend
```
frontend/src/api/forms.api.ts                      — Form CRUD + public form API client
frontend/src/api/intake.api.ts                     — Intake queue API client
frontend/src/components/ui/FormBuilder.tsx          — Container: page list + field editor + DnD
frontend/src/components/ui/FormPageEditor.tsx       — Page editor with fields and conditions
frontend/src/components/ui/FormFieldEditor.tsx      — Field config panel
frontend/src/components/ui/FieldOptionEditor.tsx    — Options editor for select/radio/multiselect
frontend/src/components/ui/BranchingConfig.tsx      — Page condition configuration
frontend/src/components/ui/FormPreview.tsx          — Admin preview of the form
frontend/src/components/ui/FormWizard.tsx           — Public multi-step form renderer
frontend/src/components/ui/WizardProgress.tsx       — Step indicator for multi-page forms
frontend/src/pages/projects/FormsSettings.tsx       — Form list + create in project settings
frontend/src/pages/projects/FormBuilderPage.tsx     — Full form editor page
frontend/src/pages/intake/IntakeQueue.tsx           — Submission moderation page
frontend/src/pages/public/PublicForm.tsx            — Public form page at /f/:slug
```

---

### Task 1: Schema — Add Form Models

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add enums**

```prisma
enum FormStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

enum FormAuthMode {
  PUBLIC
  TOKEN_GATED
}

enum FormSpamProtection {
  NONE
  CAPTCHA
  RATE_LIMIT
}

enum FormFieldType {
  TEXT
  TEXTAREA
  SELECT
  MULTISELECT
  CHECKBOX
  RADIO
  DATE
  FILE
  HEADING
  DESCRIPTION
}

enum SubmissionStatus {
  PENDING
  APPROVED
  REJECTED
  SPAM
}
```

- [ ] **Step 2: Add Form model**

```prisma
model Form {
  id               String             @id @default(cuid())
  projectId        String
  name             String
  slug             String             @unique
  description      String?
  status           FormStatus         @default(DRAFT)
  authMode         FormAuthMode       @default(PUBLIC)
  sharedSecret     String?
  spamProtection   FormSpamProtection @default(NONE)
  rateLimitPerHour Int?
  successMessage   String?
  redirectUrl      String?
  createdById      String
  createdAt        DateTime           @default(now())
  updatedAt        DateTime           @updatedAt

  project     Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdBy   User             @relation("formCreator", fields: [createdById], references: [id])
  pages       FormPage[]
  submissions FormSubmission[]

  @@index([projectId])
}
```

- [ ] **Step 3: Add FormPage model**

```prisma
model FormPage {
  id                String     @id @default(cuid())
  formId            String
  title             String
  position          Int
  conditionFieldId  String?
  conditionOperator String?
  conditionValue    String?

  form            Form        @relation(fields: [formId], references: [id], onDelete: Cascade)
  conditionField  FormField?  @relation("pageCondition", fields: [conditionFieldId], references: [id], onDelete: SetNull)
  fields          FormField[] @relation("pageFields")

  @@index([formId])
}
```

- [ ] **Step 4: Add FormField model**

```prisma
model FormField {
  id               String        @id @default(cuid())
  formPageId       String
  position         Int
  type             FormFieldType
  label            String
  placeholder      String?
  helpText         String?
  required         Boolean       @default(false)
  options          Json?
  issueFieldMapping String?
  validationRules  Json?

  page             FormPage   @relation("pageFields", fields: [formPageId], references: [id], onDelete: Cascade)
  conditionPages   FormPage[] @relation("pageCondition")

  @@index([formPageId])
}
```

- [ ] **Step 5: Add FormSubmission model**

```prisma
model FormSubmission {
  id             String           @id @default(cuid())
  formId         String
  projectId      String
  status         SubmissionStatus @default(PENDING)
  data           Json
  submitterEmail String?
  submitterName  String?
  submitterIp    String
  issueId        String?
  reviewedById   String?
  reviewedAt     DateTime?
  reviewNote     String?
  createdAt      DateTime         @default(now())

  form       Form     @relation(fields: [formId], references: [id], onDelete: Cascade)
  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  issue      Issue?   @relation(fields: [issueId], references: [id], onDelete: SetNull)
  reviewedBy User?    @relation("submissionReviewer", fields: [reviewedById], references: [id])

  @@index([formId, status])
  @@index([projectId, status])
}
```

- [ ] **Step 6: Add reverse relations**

Add to `Project`:
```prisma
  forms           Form[]
  formSubmissions FormSubmission[]
```

Add to `User`:
```prisma
  formsCreated       Form[]           @relation("formCreator")
  submissionsReviewed FormSubmission[] @relation("submissionReviewer")
```

Add to `Issue`:
```prisma
  formSubmissions FormSubmission[]
```

- [ ] **Step 7: Push schema**

Run: `npx prisma db push && npx prisma generate`
Expected: Success.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(forms): add Form, FormPage, FormField, FormSubmission models"
```

---

### Task 2: Backend — Form Validation Schemas

**Files:**
- Create: `src/modules/forms/forms.validation.ts`

- [ ] **Step 1: Write schemas**

```typescript
import { z } from 'zod';

export const createFormSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes'),
  description: z.string().max(2000).optional(),
  authMode: z.enum(['PUBLIC', 'TOKEN_GATED']).default('PUBLIC'),
  sharedSecret: z.string().min(4).max(100).optional(),
  spamProtection: z.enum(['NONE', 'CAPTCHA', 'RATE_LIMIT']).default('NONE'),
  rateLimitPerHour: z.number().int().min(1).max(10000).optional(),
  successMessage: z.string().max(2000).optional(),
  redirectUrl: z.string().url().max(2000).optional(),
});

export const updateFormSchema = createFormSchema.partial();

export const createPageSchema = z.object({
  title: z.string().min(1).max(200),
  position: z.number().int().min(0).optional(),
  conditionFieldId: z.string().optional(),
  conditionOperator: z.enum(['EQUALS', 'NOT_EQUALS', 'CONTAINS', 'GT', 'LT']).optional(),
  conditionValue: z.string().max(500).optional(),
});

export const updatePageSchema = createPageSchema.partial();

export const reorderPagesSchema = z.object({
  pageIds: z.array(z.string().min(1)).min(1),
});

export const createFieldSchema = z.object({
  type: z.enum(['TEXT', 'TEXTAREA', 'SELECT', 'MULTISELECT', 'CHECKBOX', 'RADIO', 'DATE', 'FILE', 'HEADING', 'DESCRIPTION']),
  label: z.string().min(1).max(200),
  placeholder: z.string().max(200).optional(),
  helpText: z.string().max(500).optional(),
  required: z.boolean().default(false),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  issueFieldMapping: z.string().max(200).optional(),
  validationRules: z.object({
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).optional(),
    pattern: z.string().max(500).optional(),
  }).optional(),
  position: z.number().int().min(0).optional(),
});

export const updateFieldSchema = createFieldSchema.partial();

export const reorderFieldsSchema = z.object({
  fieldIds: z.array(z.string().min(1)).min(1),
});

export const submitFormSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  submitterEmail: z.string().email().max(254).optional(),
  submitterName: z.string().max(200).optional(),
  captchaToken: z.string().optional(),
  honeypot: z.string().optional(),
});

export const verifyFormSchema = z.object({
  secret: z.string().optional(),
  captchaToken: z.string().optional(),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/forms/forms.validation.ts
git commit -m "feat(forms): add validation schemas"
```

---

### Task 3: Backend — Forms Service

**Files:**
- Create: `src/modules/forms/forms.service.ts`

- [ ] **Step 1: Write form CRUD service**

```typescript
import { prisma } from '../../config/database';
import { AppError } from '../../utils/errors';
import { findOrThrow } from '../../utils/findOrThrow';
import { logger } from '../../config/logger';
import bcrypt from 'bcryptjs';

const FORM_INCLUDE = {
  pages: {
    include: {
      fields: { orderBy: { position: 'asc' as const } },
      conditionField: { select: { id: true, label: true, formPageId: true } },
    },
    orderBy: { position: 'asc' as const },
  },
};

export async function listForms(projectId: string) {
  return prisma.form.findMany({
    where: { projectId },
    include: { _count: { select: { submissions: true, pages: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getForm(formId: string, projectId: string) {
  return findOrThrow(
    prisma.form.findFirst({ where: { id: formId, projectId }, include: FORM_INCLUDE }),
    'Form not found',
  );
}

export async function getPublicForm(slug: string) {
  const form = await findOrThrow(
    prisma.form.findUnique({ where: { slug }, include: FORM_INCLUDE }),
    'Form not found',
  );
  if (form.status !== 'PUBLISHED') throw new AppError(404, 'Form not found');
  return form;
}

export async function createForm(
  projectId: string,
  createdById: string,
  data: {
    name: string; slug: string; description?: string; authMode?: string;
    sharedSecret?: string; spamProtection?: string; rateLimitPerHour?: number;
    successMessage?: string; redirectUrl?: string;
  },
) {
  // Check slug uniqueness
  const existing = await prisma.form.findUnique({ where: { slug: data.slug } });
  if (existing) throw new AppError(409, 'A form with this slug already exists');

  const hashedSecret = data.sharedSecret ? await bcrypt.hash(data.sharedSecret, 10) : undefined;

  return prisma.form.create({
    data: {
      projectId,
      createdById,
      name: data.name,
      slug: data.slug,
      description: data.description,
      authMode: (data.authMode as any) || 'PUBLIC',
      sharedSecret: hashedSecret,
      spamProtection: (data.spamProtection as any) || 'NONE',
      rateLimitPerHour: data.rateLimitPerHour,
      successMessage: data.successMessage,
      redirectUrl: data.redirectUrl,
    },
    include: FORM_INCLUDE,
  });
}

export async function updateForm(
  formId: string,
  projectId: string,
  data: Record<string, unknown>,
) {
  await findOrThrow(
    prisma.form.findFirst({ where: { id: formId, projectId } }),
    'Form not found',
  );

  const updateData: Record<string, unknown> = { ...data };
  if (data.sharedSecret && typeof data.sharedSecret === 'string') {
    updateData.sharedSecret = await bcrypt.hash(data.sharedSecret, 10);
  }

  return prisma.form.update({
    where: { id: formId },
    data: updateData as any,
    include: FORM_INCLUDE,
  });
}

export async function deleteForm(formId: string, projectId: string) {
  await findOrThrow(
    prisma.form.findFirst({ where: { id: formId, projectId } }),
    'Form not found',
  );
  await prisma.form.delete({ where: { id: formId } });
}

export async function publishForm(formId: string, projectId: string) {
  const form = await findOrThrow(
    prisma.form.findFirst({ where: { id: formId, projectId }, include: FORM_INCLUDE }),
    'Form not found',
  );

  // Validation: must have at least one page with one field mapped to title
  if (form.pages.length === 0) throw new AppError(400, 'Form must have at least one page');
  const allFields = form.pages.flatMap((p) => p.fields);
  const hasTitleMapping = allFields.some((f) => f.issueFieldMapping === 'title');
  if (!hasTitleMapping) throw new AppError(400, 'At least one field must be mapped to issue title');

  const newStatus = form.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
  return prisma.form.update({
    where: { id: formId },
    data: { status: newStatus },
    include: FORM_INCLUDE,
  });
}

// Page CRUD
export async function createPage(
  formId: string,
  data: { title: string; position?: number; conditionFieldId?: string; conditionOperator?: string; conditionValue?: string },
) {
  const pageCount = await prisma.formPage.count({ where: { formId } });
  return prisma.formPage.create({
    data: {
      formId,
      title: data.title,
      position: data.position ?? pageCount,
      conditionFieldId: data.conditionFieldId,
      conditionOperator: data.conditionOperator,
      conditionValue: data.conditionValue,
    },
    include: { fields: { orderBy: { position: 'asc' } }, conditionField: { select: { id: true, label: true, formPageId: true } } },
  });
}

export async function updatePage(
  pageId: string,
  data: Record<string, unknown>,
) {
  await findOrThrow(prisma.formPage.findUnique({ where: { id: pageId } }), 'Page not found');
  return prisma.formPage.update({
    where: { id: pageId },
    data: data as any,
    include: { fields: { orderBy: { position: 'asc' } }, conditionField: { select: { id: true, label: true, formPageId: true } } },
  });
}

export async function deletePage(pageId: string) {
  await findOrThrow(prisma.formPage.findUnique({ where: { id: pageId } }), 'Page not found');
  await prisma.formPage.delete({ where: { id: pageId } });
}

export async function reorderPages(formId: string, pageIds: string[]) {
  const updates = pageIds.map((id, i) =>
    prisma.formPage.update({ where: { id }, data: { position: i } }),
  );
  await prisma.$transaction(updates);
}

// Field CRUD
export async function createField(
  pageId: string,
  data: {
    type: string; label: string; placeholder?: string; helpText?: string;
    required?: boolean; options?: unknown; issueFieldMapping?: string;
    validationRules?: unknown; position?: number;
  },
) {
  const fieldCount = await prisma.formField.count({ where: { formPageId: pageId } });
  return prisma.formField.create({
    data: {
      formPageId: pageId,
      type: data.type as any,
      label: data.label,
      placeholder: data.placeholder,
      helpText: data.helpText,
      required: data.required ?? false,
      options: data.options as any,
      issueFieldMapping: data.issueFieldMapping,
      validationRules: data.validationRules as any,
      position: data.position ?? fieldCount,
    },
  });
}

export async function updateField(fieldId: string, data: Record<string, unknown>) {
  await findOrThrow(prisma.formField.findUnique({ where: { id: fieldId } }), 'Field not found');
  return prisma.formField.update({ where: { id: fieldId }, data: data as any });
}

export async function deleteField(fieldId: string) {
  await findOrThrow(prisma.formField.findUnique({ where: { id: fieldId } }), 'Field not found');
  await prisma.formField.delete({ where: { id: fieldId } });
}

export async function reorderFields(formId: string, fieldIds: string[]) {
  const updates = fieldIds.map((id, i) =>
    prisma.formField.update({ where: { id }, data: { position: i } }),
  );
  await prisma.$transaction(updates);
}

// Public form submission
export async function submitForm(
  slug: string,
  data: Record<string, unknown>,
  submitterEmail: string | undefined,
  submitterName: string | undefined,
  submitterIp: string,
  honeypot: string | undefined,
) {
  const form = await getPublicForm(slug);

  // Honeypot check
  if (honeypot) {
    logger.info('Honeypot triggered', { formId: form.id, ip: submitterIp });
    // Still create submission but mark as spam
    return prisma.formSubmission.create({
      data: {
        formId: form.id,
        projectId: form.projectId,
        status: 'SPAM',
        data: data as any,
        submitterEmail,
        submitterName,
        submitterIp,
      },
    });
  }

  const submission = await prisma.formSubmission.create({
    data: {
      formId: form.id,
      projectId: form.projectId,
      status: 'PENDING',
      data: data as any,
      submitterEmail,
      submitterName,
      submitterIp,
    },
  });

  // Broadcast to project room for real-time intake queue
  const { broadcastToRoom } = await import('../../realtime/broadcast');
  broadcastToRoom(`project:${form.projectId}`, {
    type: 'form:submission:created',
    projectId: form.projectId,
    submissionId: submission.id,
  });

  return submission;
}

export async function verifyFormAccess(slug: string, secret?: string) {
  const form = await getPublicForm(slug);
  if (form.authMode === 'PUBLIC') return { verified: true };
  if (!secret) throw new AppError(401, 'This form requires a secret to access');
  if (!form.sharedSecret) throw new AppError(500, 'Form misconfigured');
  const match = await bcrypt.compare(secret, form.sharedSecret);
  if (!match) throw new AppError(401, 'Invalid secret');
  return { verified: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/forms/forms.service.ts
git commit -m "feat(forms): add forms service with CRUD, pages, fields, and public submission"
```

---

### Task 4: Backend — Forms Controller

**Files:**
- Create: `src/modules/forms/forms.controller.ts`

- [ ] **Step 1: Write controller**

```typescript
import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate } from '../../utils/validation';
import {
  createFormSchema, updateFormSchema,
  createPageSchema, updatePageSchema, reorderPagesSchema,
  createFieldSchema, updateFieldSchema, reorderFieldsSchema,
} from './forms.validation';
import * as formsService from './forms.service';

// Form CRUD
export const list = asyncHandler(async (req: Request, res: Response) => {
  const forms = await formsService.listForms(param(req, 'projectId'));
  res.json(forms);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const form = await formsService.getForm(param(req, 'formId'), param(req, 'projectId'));
  res.json(form);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createFormSchema, req.body);
  const form = await formsService.createForm(param(req, 'projectId'), req.userId!, data);
  res.status(201).json(form);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updateFormSchema, req.body);
  const form = await formsService.updateForm(param(req, 'formId'), param(req, 'projectId'), data);
  res.json(form);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await formsService.deleteForm(param(req, 'formId'), param(req, 'projectId'));
  res.status(204).send();
});

export const publish = asyncHandler(async (req: Request, res: Response) => {
  const form = await formsService.publishForm(param(req, 'formId'), param(req, 'projectId'));
  res.json(form);
});

// Pages
export const createPage = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createPageSchema, req.body);
  const page = await formsService.createPage(param(req, 'formId'), data);
  res.status(201).json(page);
});

export const updatePage = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updatePageSchema, req.body);
  const page = await formsService.updatePage(param(req, 'pageId'), data);
  res.json(page);
});

export const removePage = asyncHandler(async (req: Request, res: Response) => {
  await formsService.deletePage(param(req, 'pageId'));
  res.status(204).send();
});

export const reorderPages = asyncHandler(async (req: Request, res: Response) => {
  const { pageIds } = validate(reorderPagesSchema, req.body);
  await formsService.reorderPages(param(req, 'formId'), pageIds);
  res.status(204).send();
});

// Fields
export const createField = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createFieldSchema, req.body);
  const field = await formsService.createField(param(req, 'pageId'), data);
  res.status(201).json(field);
});

export const updateField = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updateFieldSchema, req.body);
  const field = await formsService.updateField(param(req, 'fieldId'), data);
  res.json(field);
});

export const removeField = asyncHandler(async (req: Request, res: Response) => {
  await formsService.deleteField(param(req, 'fieldId'));
  res.status(204).send();
});

export const reorderFields = asyncHandler(async (req: Request, res: Response) => {
  const { fieldIds } = validate(reorderFieldsSchema, req.body);
  await formsService.reorderFields(param(req, 'formId'), fieldIds);
  res.status(204).send();
});
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/forms/forms.controller.ts
git commit -m "feat(forms): add forms controller"
```

---

### Task 5: Backend — Public Forms Controller

**Files:**
- Create: `src/modules/forms/public-forms.controller.ts`

- [ ] **Step 1: Write public controller**

```typescript
import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../utils/validation';
import { submitFormSchema, verifyFormSchema } from './forms.validation';
import * as formsService from './forms.service';

export const getPublicForm = asyncHandler(async (req: Request, res: Response) => {
  const form = await formsService.getPublicForm(req.params.formSlug);
  // Strip sensitive fields
  const { sharedSecret, ...publicForm } = form;
  res.json({ ...publicForm, authMode: form.authMode });
});

export const submitForm = asyncHandler(async (req: Request, res: Response) => {
  const { data, submitterEmail, submitterName, honeypot } = validate(submitFormSchema, req.body);
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const submission = await formsService.submitForm(
    req.params.formSlug,
    data as Record<string, unknown>,
    submitterEmail,
    submitterName,
    ip,
    honeypot,
  );
  res.status(201).json({ id: submission.id, status: submission.status });
});

export const verifyAccess = asyncHandler(async (req: Request, res: Response) => {
  const { secret } = validate(verifyFormSchema, req.body);
  const result = await formsService.verifyFormAccess(req.params.formSlug, secret);
  res.json(result);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/forms/public-forms.controller.ts
git commit -m "feat(forms): add public forms controller"
```

---

### Task 6: Backend — Intake Service

**Files:**
- Create: `src/modules/intake/intake.service.ts`
- Create: `src/modules/intake/intake.validation.ts`

- [ ] **Step 1: Write intake validation**

```typescript
import { z } from 'zod';

export const listSubmissionsSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SPAM']).optional(),
  formId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const reviewSubmissionSchema = z.object({
  reviewNote: z.string().max(2000).optional(),
});

export const approveSubmissionSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(100000).optional(),
  type: z.enum(['TASK', 'BUG', 'STORY', 'EPIC']).optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  assigneeId: z.string().optional(),
  labels: z.array(z.string()).optional(),
});
```

- [ ] **Step 2: Write intake service**

```typescript
import { prisma } from '../../config/database';
import { AppError } from '../../utils/errors';
import { findOrThrow } from '../../utils/findOrThrow';
import { broadcastToRoom } from '../../realtime/broadcast';
import { createNotification } from '../notifications/notifications.service';
import { createIssue } from '../issues/issues.service';
import { logger } from '../../config/logger';

export async function listSubmissions(
  projectId: string,
  filters: { status?: string; formId?: string; limit: number; offset: number },
) {
  const where: Record<string, unknown> = { projectId };
  if (filters.status) where.status = filters.status;
  if (filters.formId) where.formId = filters.formId;

  const [submissions, total] = await Promise.all([
    prisma.formSubmission.findMany({
      where: where as any,
      include: {
        form: { select: { id: true, name: true, slug: true } },
        issue: { select: { id: true, number: true, title: true } },
        reviewedBy: { select: { id: true, username: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: filters.limit,
      skip: filters.offset,
    }),
    prisma.formSubmission.count({ where: where as any }),
  ]);

  return { submissions, total };
}

export async function getSubmission(submissionId: string, projectId: string) {
  return findOrThrow(
    prisma.formSubmission.findFirst({
      where: { id: submissionId, projectId },
      include: {
        form: {
          include: {
            pages: {
              include: { fields: { orderBy: { position: 'asc' } } },
              orderBy: { position: 'asc' },
            },
          },
        },
        reviewedBy: { select: { id: true, username: true, displayName: true } },
      },
    }),
    'Submission not found',
  );
}

export async function approveSubmission(
  submissionId: string,
  projectId: string,
  reviewerId: string,
  issueData: {
    title: string; body?: string; type?: string; priority?: string;
    assigneeId?: string; labels?: string[];
  },
) {
  const submission = await findOrThrow(
    prisma.formSubmission.findFirst({ where: { id: submissionId, projectId, status: 'PENDING' } }),
    'Submission not found or already reviewed',
  );

  // Create the issue
  const issue = await createIssue(projectId, reviewerId, {
    title: issueData.title,
    body: issueData.body,
    type: issueData.type as any,
    priority: issueData.priority as any,
    assigneeId: issueData.assigneeId,
    labels: issueData.labels,
  });

  // Update submission
  await prisma.formSubmission.update({
    where: { id: submissionId },
    data: {
      status: 'APPROVED',
      issueId: issue.id,
      reviewedById: reviewerId,
      reviewedAt: new Date(),
    },
  });

  return { submission: { ...submission, status: 'APPROVED', issueId: issue.id }, issue };
}

export async function rejectSubmission(
  submissionId: string,
  projectId: string,
  reviewerId: string,
  reviewNote?: string,
) {
  const submission = await findOrThrow(
    prisma.formSubmission.findFirst({ where: { id: submissionId, projectId, status: 'PENDING' } }),
    'Submission not found or already reviewed',
  );

  return prisma.formSubmission.update({
    where: { id: submissionId },
    data: {
      status: 'REJECTED',
      reviewedById: reviewerId,
      reviewedAt: new Date(),
      reviewNote,
    },
  });
}

export async function markSpam(submissionId: string, projectId: string, reviewerId: string) {
  await findOrThrow(
    prisma.formSubmission.findFirst({ where: { id: submissionId, projectId } }),
    'Submission not found',
  );

  return prisma.formSubmission.update({
    where: { id: submissionId },
    data: {
      status: 'SPAM',
      reviewedById: reviewerId,
      reviewedAt: new Date(),
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/intake/intake.service.ts src/modules/intake/intake.validation.ts
git commit -m "feat(intake): add intake service with submission review and issue creation"
```

---

### Task 7: Backend — Intake Controller

**Files:**
- Create: `src/modules/intake/intake.controller.ts`

- [ ] **Step 1: Write intake controller**

```typescript
import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate } from '../../utils/validation';
import { listSubmissionsSchema, reviewSubmissionSchema, approveSubmissionSchema } from './intake.validation';
import * as intakeService from './intake.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const filters = validate(listSubmissionsSchema, req.query);
  const result = await intakeService.listSubmissions(param(req, 'projectId'), filters);
  res.json(result);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const submission = await intakeService.getSubmission(param(req, 'submissionId'), param(req, 'projectId'));
  res.json(submission);
});

export const approve = asyncHandler(async (req: Request, res: Response) => {
  const issueData = validate(approveSubmissionSchema, req.body);
  const result = await intakeService.approveSubmission(
    param(req, 'submissionId'),
    param(req, 'projectId'),
    req.userId!,
    issueData,
  );
  res.json(result);
});

export const reject = asyncHandler(async (req: Request, res: Response) => {
  const { reviewNote } = validate(reviewSubmissionSchema, req.body);
  const submission = await intakeService.rejectSubmission(
    param(req, 'submissionId'),
    param(req, 'projectId'),
    req.userId!,
    reviewNote,
  );
  res.json(submission);
});

export const markSpam = asyncHandler(async (req: Request, res: Response) => {
  const submission = await intakeService.markSpam(
    param(req, 'submissionId'),
    param(req, 'projectId'),
    req.userId!,
  );
  res.json(submission);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/intake/intake.controller.ts
git commit -m "feat(intake): add intake controller"
```

---

### Task 8: Backend — Routes

**Files:**
- Create: `src/modules/forms/forms.routes.ts`
- Create: `src/modules/forms/public-forms.routes.ts`
- Create: `src/modules/intake/intake.routes.ts`
- Modify: route mounting file

- [ ] **Step 1: Write authenticated form routes**

```typescript
import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import * as formsController from './forms.controller';

const router = Router();
router.use(authenticate);

router.get('/:projectId/forms', requireProjectAccess, formsController.list);
router.post('/:projectId/forms', requireProjectAccess, formsController.create);
router.get('/:projectId/forms/:formId', requireProjectAccess, formsController.get);
router.patch('/:projectId/forms/:formId', requireProjectAccess, formsController.update);
router.delete('/:projectId/forms/:formId', requireProjectAccess, formsController.remove);
router.patch('/:projectId/forms/:formId/publish', requireProjectAccess, formsController.publish);

// Pages
router.post('/:projectId/forms/:formId/pages', requireProjectAccess, formsController.createPage);
router.patch('/:projectId/forms/:formId/pages/:pageId', requireProjectAccess, formsController.updatePage);
router.delete('/:projectId/forms/:formId/pages/:pageId', requireProjectAccess, formsController.removePage);
router.post('/:projectId/forms/:formId/pages/reorder', requireProjectAccess, formsController.reorderPages);

// Fields
router.post('/:projectId/forms/:formId/pages/:pageId/fields', requireProjectAccess, formsController.createField);
router.patch('/:projectId/forms/:formId/pages/:pageId/fields/:fieldId', requireProjectAccess, formsController.updateField);
router.delete('/:projectId/forms/:formId/pages/:pageId/fields/:fieldId', requireProjectAccess, formsController.removeField);
router.post('/:projectId/forms/:formId/fields/reorder', requireProjectAccess, formsController.reorderFields);

export default router;
```

- [ ] **Step 2: Write public form routes**

```typescript
import { Router } from 'express';
import * as publicFormsController from './public-forms.controller';

const router = Router();

// No auth middleware — these are public
router.get('/f/:formSlug', publicFormsController.getPublicForm);
router.post('/f/:formSlug/submit', publicFormsController.submitForm);
router.post('/f/:formSlug/verify', publicFormsController.verifyAccess);

export default router;
```

- [ ] **Step 3: Write intake routes**

```typescript
import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import * as intakeController from './intake.controller';

const router = Router();
router.use(authenticate);

router.get('/:projectId/intake', requireProjectAccess, intakeController.list);
router.get('/:projectId/intake/:submissionId', requireProjectAccess, intakeController.get);
router.post('/:projectId/intake/:submissionId/approve', requireProjectAccess, intakeController.approve);
router.post('/:projectId/intake/:submissionId/reject', requireProjectAccess, intakeController.reject);
router.post('/:projectId/intake/:submissionId/spam', requireProjectAccess, intakeController.markSpam);

export default router;
```

- [ ] **Step 4: Mount routes**

In the app route mounting file:

```typescript
import formRoutes from './modules/forms/forms.routes';
import publicFormRoutes from './modules/forms/public-forms.routes';
import intakeRoutes from './modules/intake/intake.routes';

// Public routes — mount BEFORE auth middleware
app.use(publicFormRoutes);

// Authenticated routes
app.use('/api/projects', formRoutes);
app.use('/api/projects', intakeRoutes);
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/forms/forms.routes.ts src/modules/forms/public-forms.routes.ts src/modules/intake/intake.routes.ts
git add <route-mounting-file>
git commit -m "feat(forms): add routes for forms, public forms, and intake queue"
```

---

### Task 9: Backend — Integration Tests

**Files:**
- Create: `src/modules/forms/forms.test.ts`
- Create: `src/modules/intake/intake.test.ts`

- [ ] **Step 1: Write forms integration tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { createTestContext, type TestContext } from '../../test/factory';
import { truncateAllTables, disconnectPrisma } from '../../test/test-utils';

describe('Forms', () => {
  let ctx: TestContext;
  let formId: string;
  let pageId: string;
  let fieldId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await truncateAllTables();
    await disconnectPrisma();
  });

  it('should create a form', async () => {
    const res = await request(app)
      .post(`/api/projects/${ctx.project.id}/forms`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Bug Report', slug: `bug-report-${Date.now()}` });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Bug Report');
    formId = res.body.id;
  });

  it('should create a page', async () => {
    const res = await request(app)
      .post(`/api/projects/${ctx.project.id}/forms/${formId}/pages`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Basic Info' });

    expect(res.status).toBe(201);
    pageId = res.body.id;
  });

  it('should create a field mapped to title', async () => {
    const res = await request(app)
      .post(`/api/projects/${ctx.project.id}/forms/${formId}/pages/${pageId}/fields`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ type: 'TEXT', label: 'Bug Title', required: true, issueFieldMapping: 'title' });

    expect(res.status).toBe(201);
    fieldId = res.body.id;
  });

  it('should publish the form', async () => {
    const res = await request(app)
      .patch(`/api/projects/${ctx.project.id}/forms/${formId}/publish`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PUBLISHED');
  });

  it('should reject publish without title mapping', async () => {
    // Create another form without title mapping
    const formRes = await request(app)
      .post(`/api/projects/${ctx.project.id}/forms`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'No Title', slug: `no-title-${Date.now()}` });

    const pageRes = await request(app)
      .post(`/api/projects/${ctx.project.id}/forms/${formRes.body.id}/pages`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Page 1' });

    await request(app)
      .post(`/api/projects/${ctx.project.id}/forms/${formRes.body.id}/pages/${pageRes.body.id}/fields`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ type: 'TEXT', label: 'Notes' });

    const publishRes = await request(app)
      .patch(`/api/projects/${ctx.project.id}/forms/${formRes.body.id}/publish`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(publishRes.status).toBe(400);
  });

  it('should fetch public form by slug', async () => {
    const form = await request(app)
      .get(`/api/projects/${ctx.project.id}/forms/${formId}`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    const res = await request(app).get(`/f/${form.body.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.pages.length).toBe(1);
  });

  it('should submit a public form', async () => {
    const form = await request(app)
      .get(`/api/projects/${ctx.project.id}/forms/${formId}`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    const res = await request(app)
      .post(`/f/${form.body.slug}/submit`)
      .send({ data: { [fieldId]: 'Login button broken' }, submitterEmail: 'user@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
  });
});
```

- [ ] **Step 2: Write intake integration tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { createTestContext, type TestContext } from '../../test/factory';
import { truncateAllTables, disconnectPrisma } from '../../test/test-utils';
import { prisma } from '../../config/database';

describe('Intake Queue', () => {
  let ctx: TestContext;
  let submissionId: string;

  beforeAll(async () => {
    ctx = await createTestContext();

    // Create and publish a form, then submit
    const formRes = await request(app)
      .post(`/api/projects/${ctx.project.id}/forms`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Test Form', slug: `intake-test-${Date.now()}` });

    const pageRes = await request(app)
      .post(`/api/projects/${ctx.project.id}/forms/${formRes.body.id}/pages`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Page 1' });

    const fieldRes = await request(app)
      .post(`/api/projects/${ctx.project.id}/forms/${formRes.body.id}/pages/${pageRes.body.id}/fields`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ type: 'TEXT', label: 'Title', required: true, issueFieldMapping: 'title' });

    await request(app)
      .patch(`/api/projects/${ctx.project.id}/forms/${formRes.body.id}/publish`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    const submitRes = await request(app)
      .post(`/f/${formRes.body.slug}/submit`)
      .send({ data: { [fieldRes.body.id]: 'Test issue from form' } });

    submissionId = submitRes.body.id;
  });

  afterAll(async () => {
    await truncateAllTables();
    await disconnectPrisma();
  });

  it('should list submissions', async () => {
    const res = await request(app)
      .get(`/api/projects/${ctx.project.id}/intake`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);
    expect(res.body.submissions.length).toBeGreaterThanOrEqual(1);
  });

  it('should approve a submission and create an issue', async () => {
    const res = await request(app)
      .post(`/api/projects/${ctx.project.id}/intake/${submissionId}/approve`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Test issue from form', type: 'BUG', priority: 'MEDIUM' });

    expect(res.status).toBe(200);
    expect(res.body.issue).toBeDefined();
    expect(res.body.issue.title).toBe('Test issue from form');

    // Verify submission linked to issue
    const submission = await prisma.formSubmission.findUnique({ where: { id: submissionId } });
    expect(submission!.status).toBe('APPROVED');
    expect(submission!.issueId).toBe(res.body.issue.id);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm run test -- --testPathPattern="forms|intake"`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/forms/forms.test.ts src/modules/intake/intake.test.ts
git commit -m "test(forms): add integration tests for forms and intake queue"
```

---

### Task 10: Frontend — API Clients

**Files:**
- Create: `frontend/src/api/forms.api.ts`
- Create: `frontend/src/api/intake.api.ts`

- [ ] **Step 1: Write forms API client**

```typescript
import { get, post, patch, del } from './client';

export interface FormField {
  id: string;
  formPageId: string;
  position: number;
  type: string;
  label: string;
  placeholder: string | null;
  helpText: string | null;
  required: boolean;
  options: { label: string; value: string }[] | null;
  issueFieldMapping: string | null;
  validationRules: { minLength?: number; maxLength?: number; pattern?: string } | null;
}

export interface FormPage {
  id: string;
  formId: string;
  title: string;
  position: number;
  conditionFieldId: string | null;
  conditionOperator: string | null;
  conditionValue: string | null;
  conditionField: { id: string; label: string; formPageId: string } | null;
  fields: FormField[];
}

export interface Form {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  description: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  authMode: 'PUBLIC' | 'TOKEN_GATED';
  spamProtection: 'NONE' | 'CAPTCHA' | 'RATE_LIMIT';
  rateLimitPerHour: number | null;
  successMessage: string | null;
  redirectUrl: string | null;
  pages: FormPage[];
  _count?: { submissions: number; pages: number };
}

export const formsApi = {
  list: (projectId: string) =>
    get<Form[]>(`/api/projects/${projectId}/forms`),
  get: (projectId: string, formId: string) =>
    get<Form>(`/api/projects/${projectId}/forms/${formId}`),
  create: (projectId: string, data: { name: string; slug: string; [k: string]: unknown }) =>
    post<Form>(`/api/projects/${projectId}/forms`, data),
  update: (projectId: string, formId: string, data: Record<string, unknown>) =>
    patch<Form>(`/api/projects/${projectId}/forms/${formId}`, data),
  delete: (projectId: string, formId: string) =>
    del<void>(`/api/projects/${projectId}/forms/${formId}`),
  publish: (projectId: string, formId: string) =>
    patch<Form>(`/api/projects/${projectId}/forms/${formId}/publish`, {}),

  // Pages
  createPage: (projectId: string, formId: string, data: { title: string }) =>
    post<FormPage>(`/api/projects/${projectId}/forms/${formId}/pages`, data),
  updatePage: (projectId: string, formId: string, pageId: string, data: Record<string, unknown>) =>
    patch<FormPage>(`/api/projects/${projectId}/forms/${formId}/pages/${pageId}`, data),
  deletePage: (projectId: string, formId: string, pageId: string) =>
    del<void>(`/api/projects/${projectId}/forms/${formId}/pages/${pageId}`),
  reorderPages: (projectId: string, formId: string, pageIds: string[]) =>
    post<void>(`/api/projects/${projectId}/forms/${formId}/pages/reorder`, { pageIds }),

  // Fields
  createField: (projectId: string, formId: string, pageId: string, data: Record<string, unknown>) =>
    post<FormField>(`/api/projects/${projectId}/forms/${formId}/pages/${pageId}/fields`, data),
  updateField: (projectId: string, formId: string, pageId: string, fieldId: string, data: Record<string, unknown>) =>
    patch<FormField>(`/api/projects/${projectId}/forms/${formId}/pages/${pageId}/fields/${fieldId}`, data),
  deleteField: (projectId: string, formId: string, pageId: string, fieldId: string) =>
    del<void>(`/api/projects/${projectId}/forms/${formId}/pages/${pageId}/fields/${fieldId}`),
  reorderFields: (projectId: string, formId: string, fieldIds: string[]) =>
    post<void>(`/api/projects/${projectId}/forms/${formId}/fields/reorder`, { fieldIds }),

  // Public
  getPublic: (slug: string) =>
    get<Form>(`/f/${slug}`),
  submit: (slug: string, data: { data: Record<string, unknown>; submitterEmail?: string; submitterName?: string }) =>
    post<{ id: string; status: string }>(`/f/${slug}/submit`, data),
  verify: (slug: string, secret: string) =>
    post<{ verified: boolean }>(`/f/${slug}/verify`, { secret }),
};
```

- [ ] **Step 2: Write intake API client**

```typescript
import { get, post } from './client';

export interface FormSubmission {
  id: string;
  formId: string;
  projectId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SPAM';
  data: Record<string, unknown>;
  submitterEmail: string | null;
  submitterName: string | null;
  createdAt: string;
  form: { id: string; name: string; slug: string };
  issue: { id: string; number: number; title: string } | null;
  reviewedBy: { id: string; username: string; displayName: string | null } | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export const intakeApi = {
  list: (projectId: string, params?: { status?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString();
    return get<{ submissions: FormSubmission[]; total: number }>(`/api/projects/${projectId}/intake${qs ? `?${qs}` : ''}`);
  },

  get: (projectId: string, submissionId: string) =>
    get<FormSubmission>(`/api/projects/${projectId}/intake/${submissionId}`),

  approve: (projectId: string, submissionId: string, issueData: { title: string; body?: string; type?: string; priority?: string; labels?: string[] }) =>
    post<{ submission: FormSubmission; issue: { id: string; number: number; title: string } }>(`/api/projects/${projectId}/intake/${submissionId}/approve`, issueData),

  reject: (projectId: string, submissionId: string, reviewNote?: string) =>
    post<FormSubmission>(`/api/projects/${projectId}/intake/${submissionId}/reject`, { reviewNote }),

  spam: (projectId: string, submissionId: string) =>
    post<FormSubmission>(`/api/projects/${projectId}/intake/${submissionId}/spam`, {}),
};
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/forms.api.ts frontend/src/api/intake.api.ts
git commit -m "feat(forms): add frontend API clients for forms and intake"
```

---

### Task 11: Frontend — Form Builder Components

**Files:**
- Create: `frontend/src/components/ui/FormFieldEditor.tsx`
- Create: `frontend/src/components/ui/FieldOptionEditor.tsx`
- Create: `frontend/src/components/ui/BranchingConfig.tsx`
- Create: `frontend/src/components/ui/FormPageEditor.tsx`
- Create: `frontend/src/components/ui/FormBuilder.tsx`

This task creates the core form builder components. Each is focused on one responsibility. See the spec for full field types and branching logic. Implementation should follow the existing component conventions (forwardRef where applicable, cn(), CSS tokens, Lucide icons).

- [ ] **Step 1: Write FieldOptionEditor**

A list editor for select/radio/multiselect options. Accepts `options` array and `onChange` callback. Each option has label + value. Add/remove/reorder rows.

```tsx
import { useState } from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { Button } from './Button';

interface Option {
  label: string;
  value: string;
}

interface FieldOptionEditorProps {
  options: Option[];
  onChange: (options: Option[]) => void;
}

export function FieldOptionEditor({ options, onChange }: FieldOptionEditorProps) {
  const addOption = () => {
    onChange([...options, { label: '', value: '' }]);
  };

  const updateOption = (index: number, field: 'label' | 'value', val: string) => {
    const updated = [...options];
    updated[index] = { ...updated[index], [field]: val };
    // Auto-generate value from label if value is empty
    if (field === 'label' && !updated[index].value) {
      updated[index].value = val.toLowerCase().replace(/\s+/g, '-');
    }
    onChange(updated);
  };

  const removeOption = (index: number) => {
    onChange(options.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-text-secondary">Options</label>
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-text-tertiary shrink-0 cursor-grab" />
          <input
            value={opt.label}
            onChange={(e) => updateOption(i, 'label', e.target.value)}
            placeholder="Label"
            className="flex-1 px-2 py-1.5 bg-surface border border-border rounded text-sm text-text placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <input
            value={opt.value}
            onChange={(e) => updateOption(i, 'value', e.target.value)}
            placeholder="Value"
            className="flex-1 px-2 py-1.5 bg-surface border border-border rounded text-sm text-text placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button onClick={() => removeOption(i)} className="text-text-tertiary hover:text-danger">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={addOption}>
        <Plus className="h-4 w-4" /> Add Option
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Write BranchingConfig**

Condition editor for page display logic. Selects a field from previous pages, an operator, and a value.

```tsx
import type { FormField } from '@/api/forms.api';

interface BranchingConfigProps {
  availableFields: FormField[];
  conditionFieldId: string | null;
  conditionOperator: string | null;
  conditionValue: string | null;
  onChange: (condition: { conditionFieldId: string | null; conditionOperator: string | null; conditionValue: string | null }) => void;
}

const operators = [
  { value: 'EQUALS', label: 'equals' },
  { value: 'NOT_EQUALS', label: 'does not equal' },
  { value: 'CONTAINS', label: 'contains' },
  { value: 'GT', label: 'greater than' },
  { value: 'LT', label: 'less than' },
];

export function BranchingConfig({ availableFields, conditionFieldId, conditionOperator, conditionValue, onChange }: BranchingConfigProps) {
  const selectClasses = 'px-2 py-1.5 bg-surface border border-border rounded text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/30';

  return (
    <div className="space-y-2 p-3 bg-surface-secondary rounded-lg border border-border">
      <label className="block text-xs font-medium text-text-secondary">Show this page when...</label>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={conditionFieldId || ''}
          onChange={(e) => onChange({ conditionFieldId: e.target.value || null, conditionOperator, conditionValue })}
          className={selectClasses}
        >
          <option value="">Always show</option>
          {availableFields.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>

        {conditionFieldId && (
          <>
            <select
              value={conditionOperator || 'EQUALS'}
              onChange={(e) => onChange({ conditionFieldId, conditionOperator: e.target.value, conditionValue })}
              className={selectClasses}
            >
              {operators.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>

            <input
              value={conditionValue || ''}
              onChange={(e) => onChange({ conditionFieldId, conditionOperator, conditionValue: e.target.value })}
              placeholder="Value"
              className="px-2 py-1.5 bg-surface border border-border rounded text-sm text-text placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write FormFieldEditor**

Field config panel for a single form field.

```tsx
import { useState } from 'react';
import { Trash2, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { Button } from './Button';
import { FieldOptionEditor } from './FieldOptionEditor';
import { cn } from '@/lib/utils';
import type { FormField } from '@/api/forms.api';

const fieldTypes = [
  { value: 'TEXT', label: 'Short Text' },
  { value: 'TEXTAREA', label: 'Long Text' },
  { value: 'SELECT', label: 'Dropdown' },
  { value: 'MULTISELECT', label: 'Multi-Select' },
  { value: 'CHECKBOX', label: 'Checkbox' },
  { value: 'RADIO', label: 'Radio Buttons' },
  { value: 'DATE', label: 'Date' },
  { value: 'FILE', label: 'File Upload' },
  { value: 'HEADING', label: 'Heading (display only)' },
  { value: 'DESCRIPTION', label: 'Description (display only)' },
];

const issueFieldMappings = [
  { value: '', label: 'No mapping' },
  { value: 'title', label: 'Issue Title' },
  { value: 'body', label: 'Issue Body' },
  { value: 'type', label: 'Issue Type' },
  { value: 'priority', label: 'Priority' },
  { value: 'labels', label: 'Labels' },
];

interface FormFieldEditorProps {
  field: FormField;
  onUpdate: (data: Record<string, unknown>) => void;
  onDelete: () => void;
}

export function FormFieldEditor({ field, onUpdate, onDelete }: FormFieldEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const needsOptions = ['SELECT', 'MULTISELECT', 'RADIO'].includes(field.type);
  const isDisplay = ['HEADING', 'DESCRIPTION'].includes(field.type);

  const inputClasses = 'w-full px-2 py-1.5 bg-surface border border-border rounded text-sm text-text placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30';
  const selectClasses = inputClasses;

  return (
    <div className="border border-border rounded-lg bg-surface">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-secondary"
        onClick={() => setExpanded(!expanded)}
      >
        <GripVertical className="h-4 w-4 text-text-tertiary shrink-0 cursor-grab" />
        <span className="text-sm font-medium text-text flex-1">{field.label || 'Untitled Field'}</span>
        <span className="text-xs text-text-tertiary">{fieldTypes.find((t) => t.value === field.type)?.label}</span>
        {field.required && <span className="text-xs text-danger">Required</span>}
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Type</label>
              <select value={field.type} onChange={(e) => onUpdate({ type: e.target.value })} className={selectClasses}>
                {fieldTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Label</label>
              <input value={field.label} onChange={(e) => onUpdate({ label: e.target.value })} className={inputClasses} />
            </div>
          </div>

          {!isDisplay && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Placeholder</label>
                  <input value={field.placeholder || ''} onChange={(e) => onUpdate({ placeholder: e.target.value })} className={inputClasses} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Help Text</label>
                  <input value={field.helpText || ''} onChange={(e) => onUpdate({ helpText: e.target.value })} className={inputClasses} />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => onUpdate({ required: e.target.checked })}
                    className="rounded border-border"
                  />
                  Required
                </label>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Maps to Issue Field</label>
                  <select
                    value={field.issueFieldMapping || ''}
                    onChange={(e) => onUpdate({ issueFieldMapping: e.target.value || null })}
                    className={selectClasses}
                  >
                    {issueFieldMappings.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}

          {needsOptions && (
            <FieldOptionEditor
              options={field.options || []}
              onChange={(options) => onUpdate({ options })}
            />
          )}

          <div className="flex justify-end">
            <Button variant="danger" size="sm" onClick={onDelete}>
              <Trash2 className="h-4 w-4" /> Remove Field
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write FormPageEditor**

Page editor: title, branching config, list of fields.

```tsx
import { ChevronDown, ChevronUp, Plus, Trash2, FileText } from 'lucide-react';
import { useState } from 'react';
import { Button } from './Button';
import { FormFieldEditor } from './FormFieldEditor';
import { BranchingConfig } from './BranchingConfig';
import type { FormPage, FormField } from '@/api/forms.api';

interface FormPageEditorProps {
  page: FormPage;
  pageIndex: number;
  availableFieldsForCondition: FormField[];
  onUpdatePage: (data: Record<string, unknown>) => void;
  onDeletePage: () => void;
  onAddField: (type: string) => void;
  onUpdateField: (fieldId: string, data: Record<string, unknown>) => void;
  onDeleteField: (fieldId: string) => void;
}

export function FormPageEditor({
  page, pageIndex, availableFieldsForCondition,
  onUpdatePage, onDeletePage, onAddField, onUpdateField, onDeleteField,
}: FormPageEditorProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border border-border rounded-lg bg-surface-elevated">
      <div className="flex items-center gap-2 px-4 py-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <FileText className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-semibold text-text flex-1">
          Page {pageIndex + 1}: {page.title || 'Untitled'}
        </span>
        <span className="text-xs text-text-tertiary">{page.fields.length} field{page.fields.length !== 1 ? 's' : ''}</span>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
          {/* Page title */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Page Title</label>
            <input
              value={page.title}
              onChange={(e) => onUpdatePage({ title: e.target.value })}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Branching condition (not for first page) */}
          {pageIndex > 0 && (
            <BranchingConfig
              availableFields={availableFieldsForCondition}
              conditionFieldId={page.conditionFieldId}
              conditionOperator={page.conditionOperator}
              conditionValue={page.conditionValue}
              onChange={(condition) => onUpdatePage(condition)}
            />
          )}

          {/* Fields */}
          <div className="space-y-2">
            {page.fields.map((field) => (
              <FormFieldEditor
                key={field.id}
                field={field}
                onUpdate={(data) => onUpdateField(field.id, data)}
                onDelete={() => onDeleteField(field.id)}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onAddField('TEXT')}>
              <Plus className="h-4 w-4" /> Add Field
            </Button>
            <Button variant="ghost" size="sm" onClick={onDeletePage} className="ml-auto text-danger">
              <Trash2 className="h-4 w-4" /> Delete Page
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write FormBuilder container**

```tsx
import { Plus, Eye, Send } from 'lucide-react';
import { Button } from './Button';
import { FormPageEditor } from './FormPageEditor';
import type { Form, FormField } from '@/api/forms.api';

interface FormBuilderProps {
  form: Form;
  onAddPage: () => void;
  onUpdatePage: (pageId: string, data: Record<string, unknown>) => void;
  onDeletePage: (pageId: string) => void;
  onAddField: (pageId: string, type: string) => void;
  onUpdateField: (pageId: string, fieldId: string, data: Record<string, unknown>) => void;
  onDeleteField: (pageId: string, fieldId: string) => void;
  onPreview: () => void;
  onPublish: () => void;
}

export function FormBuilder({
  form, onAddPage, onUpdatePage, onDeletePage,
  onAddField, onUpdateField, onDeleteField,
  onPreview, onPublish,
}: FormBuilderProps) {
  // Collect all fields from pages before the current one for branching conditions
  const getAvailableFieldsForPage = (pageIndex: number): FormField[] => {
    return form.pages
      .slice(0, pageIndex)
      .flatMap((p) => p.fields)
      .filter((f) => !['HEADING', 'DESCRIPTION'].includes(f.type));
  };

  const hasTitleMapping = form.pages
    .flatMap((p) => p.fields)
    .some((f) => f.issueFieldMapping === 'title');

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onPreview}>
          <Eye className="h-4 w-4" /> Preview
        </Button>
        <Button
          onClick={onPublish}
          disabled={!hasTitleMapping || form.pages.length === 0}
          title={!hasTitleMapping ? 'At least one field must map to issue title' : undefined}
        >
          <Send className="h-4 w-4" /> {form.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
        </Button>
      </div>

      {/* Pages */}
      {form.pages.map((page, i) => (
        <FormPageEditor
          key={page.id}
          page={page}
          pageIndex={i}
          availableFieldsForCondition={getAvailableFieldsForPage(i)}
          onUpdatePage={(data) => onUpdatePage(page.id, data)}
          onDeletePage={() => onDeletePage(page.id)}
          onAddField={(type) => onAddField(page.id, type)}
          onUpdateField={(fieldId, data) => onUpdateField(page.id, fieldId, data)}
          onDeleteField={(fieldId) => onDeleteField(page.id, fieldId)}
        />
      ))}

      <Button variant="outline" onClick={onAddPage} className="w-full">
        <Plus className="h-4 w-4" /> Add Page
      </Button>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/FieldOptionEditor.tsx frontend/src/components/ui/BranchingConfig.tsx
git add frontend/src/components/ui/FormFieldEditor.tsx frontend/src/components/ui/FormPageEditor.tsx
git add frontend/src/components/ui/FormBuilder.tsx
git commit -m "feat(forms): add form builder components"
```

---

### Task 12: Frontend — Public Form Wizard

**Files:**
- Create: `frontend/src/components/ui/WizardProgress.tsx`
- Create: `frontend/src/components/ui/FormWizard.tsx`
- Create: `frontend/src/pages/public/PublicForm.tsx`

- [ ] **Step 1: Write WizardProgress**

```tsx
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WizardProgressProps {
  steps: { title: string }[];
  currentStep: number;
}

export function WizardProgress({ steps, currentStep }: WizardProgressProps) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={cn(
              'flex items-center justify-center h-7 w-7 rounded-full text-xs font-medium border',
              i < currentStep && 'bg-primary text-text-inverse border-primary',
              i === currentStep && 'bg-primary/10 text-primary border-primary',
              i > currentStep && 'bg-surface text-text-tertiary border-border',
            )}
          >
            {i < currentStep ? <Check className="h-4 w-4" /> : i + 1}
          </div>
          <span className={cn('text-sm hidden sm:inline', i === currentStep ? 'text-text font-medium' : 'text-text-tertiary')}>
            {step.title}
          </span>
          {i < steps.length - 1 && <div className="w-8 h-px bg-border" />}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write FormWizard**

```tsx
import { useState } from 'react';
import { ArrowRight, ArrowLeft, Send } from 'lucide-react';
import { Button } from './Button';
import { WizardProgress } from './WizardProgress';
import type { Form, FormPage, FormField } from '@/api/forms.api';

interface FormWizardProps {
  form: Form;
  onSubmit: (data: Record<string, unknown>, submitterEmail?: string, submitterName?: string) => void;
  isSubmitting: boolean;
}

function evaluateCondition(field: FormField | null, operator: string | null, value: string | null, formData: Record<string, unknown>): boolean {
  if (!field || !operator) return true;
  const fieldValue = String(formData[field.id] ?? '');
  switch (operator) {
    case 'EQUALS': return fieldValue === value;
    case 'NOT_EQUALS': return fieldValue !== value;
    case 'CONTAINS': return fieldValue.includes(value || '');
    case 'GT': return Number(fieldValue) > Number(value);
    case 'LT': return Number(fieldValue) < Number(value);
    default: return true;
  }
}

export function FormWizard({ form, onSubmit, isSubmitting }: FormWizardProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  // Filter pages based on branching conditions
  const visiblePages = form.pages.filter((page, i) => {
    if (i === 0) return true;
    return evaluateCondition(page.conditionField as FormField | null, page.conditionOperator, page.conditionValue, formData);
  });

  const currentPage = visiblePages[currentPageIndex];
  const isLastPage = currentPageIndex === visiblePages.length - 1;

  const setFieldValue = (fieldId: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleNext = () => {
    if (isLastPage) {
      onSubmit(formData, formData.__email as string | undefined, formData.__name as string | undefined);
    } else {
      setCurrentPageIndex((i) => Math.min(i + 1, visiblePages.length - 1));
    }
  };

  const handleBack = () => {
    setCurrentPageIndex((i) => Math.max(i - 1, 0));
  };

  const renderField = (field: FormField) => {
    const value = formData[field.id] ?? '';
    const inputClasses = 'w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30';

    switch (field.type) {
      case 'HEADING':
        return <h3 className="text-base font-semibold text-text">{field.label}</h3>;
      case 'DESCRIPTION':
        return <p className="text-sm text-text-secondary">{field.label}</p>;
      case 'TEXT':
        return <input type="text" value={String(value)} onChange={(e) => setFieldValue(field.id, e.target.value)} placeholder={field.placeholder || ''} className={inputClasses} required={field.required} />;
      case 'TEXTAREA':
        return <textarea value={String(value)} onChange={(e) => setFieldValue(field.id, e.target.value)} placeholder={field.placeholder || ''} rows={4} className={inputClasses + ' resize-none'} required={field.required} />;
      case 'SELECT':
        return (
          <select value={String(value)} onChange={(e) => setFieldValue(field.id, e.target.value)} className={inputClasses} required={field.required}>
            <option value="">{field.placeholder || 'Select...'}</option>
            {field.options?.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        );
      case 'CHECKBOX':
        return (
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={!!value} onChange={(e) => setFieldValue(field.id, e.target.checked)} className="rounded border-border" />
            {field.label}
          </label>
        );
      case 'DATE':
        return <input type="date" value={String(value)} onChange={(e) => setFieldValue(field.id, e.target.value)} className={inputClasses} required={field.required} />;
      case 'RADIO':
        return (
          <div className="space-y-2">
            {field.options?.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm text-text">
                <input type="radio" name={field.id} value={opt.value} checked={value === opt.value} onChange={(e) => setFieldValue(field.id, e.target.value)} />
                {opt.label}
              </label>
            ))}
          </div>
        );
      default:
        return <input type="text" value={String(value)} onChange={(e) => setFieldValue(field.id, e.target.value)} className={inputClasses} />;
    }
  };

  if (!currentPage) return null;

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {visiblePages.length > 1 && (
        <WizardProgress steps={visiblePages.map((p) => ({ title: p.title }))} currentStep={currentPageIndex} />
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-text">{currentPage.title}</h2>
        {currentPage.fields.map((field) => (
          <div key={field.id}>
            {field.type !== 'CHECKBOX' && field.type !== 'HEADING' && field.type !== 'DESCRIPTION' && (
              <label className="block text-sm font-medium text-text mb-1">
                {field.label}
                {field.required && <span className="text-danger ml-0.5">*</span>}
              </label>
            )}
            {field.helpText && <p className="text-xs text-text-tertiary mb-1">{field.helpText}</p>}
            {renderField(field)}
          </div>
        ))}
      </div>

      {/* Hidden honeypot field */}
      <input type="text" name="__hp" className="hidden" tabIndex={-1} autoComplete="off" onChange={(e) => setFieldValue('__honeypot', e.target.value)} />

      <div className="flex items-center justify-between pt-4 border-t border-border">
        {currentPageIndex > 0 ? (
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        ) : <div />}
        <Button onClick={handleNext} disabled={isSubmitting}>
          {isLastPage ? <><Send className="h-4 w-4" /> Submit</> : <>Next <ArrowRight className="h-4 w-4" /></>}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write PublicForm page**

```tsx
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { formsApi } from '@/api/forms.api';
import { FormWizard } from '@/components/ui/FormWizard';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { Spinner } from '@/components/ui/Spinner';
import { CheckCircle } from 'lucide-react';
import { useState } from 'react';

export default function PublicForm() {
  const { formSlug } = useParams<{ formSlug: string }>();
  const [submitted, setSubmitted] = useState(false);

  const { data: form, isLoading, error } = useQuery({
    queryKey: ['public-form', formSlug],
    queryFn: () => formsApi.getPublic(formSlug!),
    enabled: !!formSlug,
  });

  const submitMutation = useMutationWithToast(
    (payload: { data: Record<string, unknown>; submitterEmail?: string; submitterName?: string }) =>
      formsApi.submit(formSlug!, payload),
    {
      successMessage: null,
      errorMessage: 'Failed to submit form',
      onSuccess: () => setSubmitted(true),
    },
  );

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>;
  if (error || !form) return <div className="min-h-screen flex items-center justify-center text-text-secondary">Form not found</div>;

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <CheckCircle className="h-12 w-12 text-success mx-auto" />
          <h1 className="text-xl font-semibold text-text">{form.successMessage || 'Thank you for your submission!'}</h1>
          <p className="text-sm text-text-secondary">Your response has been recorded and will be reviewed shortly.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface py-12 px-4">
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-bold text-text mb-1">{form.name}</h1>
        {form.description && <p className="text-sm text-text-secondary mb-8">{form.description}</p>}
        <FormWizard
          form={form}
          onSubmit={(data, email, name) => submitMutation.mutate({ data, submitterEmail: email, submitterName: name })}
          isSubmitting={submitMutation.isPending}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Register the public route**

In App.tsx routes (outside AuthGuard):
```typescript
const PublicForm = lazy(() => import('@/pages/public/PublicForm'));

<Route path="/f/:formSlug" element={<PublicForm />} />
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/WizardProgress.tsx frontend/src/components/ui/FormWizard.tsx
git add frontend/src/pages/public/PublicForm.tsx
git add frontend/src/App.tsx
git commit -m "feat(forms): add public form wizard and page"
```

---

### Task 13: Frontend — Intake Queue Page

**Files:**
- Create: `frontend/src/pages/intake/IntakeQueue.tsx`

- [ ] **Step 1: Write IntakeQueue**

This is a table with status filter tabs, submission detail expansion, and approve/reject actions. Follow the pattern from ApprovalsSettings (Task 12 of Plan 1) — table with action buttons, modals for approve/reject. The approve modal shows a preview of the issue that will be created with editable mapped fields. Use existing components: Table, Tabs, Modal, Button, Badge, EmptyState.

The implementation follows the same patterns as the MyApprovals page — TanStack Query for data, useMutationWithToast for actions, status tabs for filtering, inline actions per row.

Key specifics:
- Status tabs: `PENDING` | `APPROVED` | `REJECTED` | `SPAM`
- Approve action opens a modal with pre-filled issue fields from submission data + field mappings
- Reject action opens a modal with a text area for the review note
- Spam action is a single click with confirmation

This component is large (~250 lines) but follows established patterns exactly. The implementing agent should reference `MyApprovals.tsx` and `ApprovalsSettings.tsx` for the exact table/modal/mutation patterns.

- [ ] **Step 2: Register route and nav link**

```typescript
const IntakeQueue = lazy(() => import('@/pages/intake/IntakeQueue'));

// In project routes:
<Route path="/:org/:team/:project/intake" element={<IntakeQueue />} />
```

Add sidebar nav link in project section:
```tsx
<NavItem to={`/${org}/${team}/${project}/intake`} icon={Inbox}>
  Intake
</NavItem>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/intake/IntakeQueue.tsx
git add <route-file> <sidebar-file>
git commit -m "feat(intake): add intake queue page with approve/reject/spam actions"
```

---

### Task 14: Frontend — Form Settings Page

**Files:**
- Create: `frontend/src/pages/projects/FormsSettings.tsx`
- Create: `frontend/src/pages/projects/FormBuilderPage.tsx`

- [ ] **Step 1: Write FormsSettings — form list page**

Table listing all forms for the project. Columns: name, status, submissions count, public URL, actions (edit, publish, delete). "Create Form" button opens a modal for name + slug input.

Follow the pattern from ApprovalsSettings — table + create form at top + empty state.

- [ ] **Step 2: Write FormBuilderPage — full form editor**

Wraps the `FormBuilder` component with data fetching and mutations:
- Fetches form by ID via `formsApi.get`
- Wires up all mutations: `createPage`, `updatePage`, `deletePage`, `createField`, `updateField`, `deleteField`, `publish`
- Each mutation invalidates `['form', formId]` query
- Includes a `FormPreview` modal toggle

- [ ] **Step 3: Register routes**

```typescript
const FormsSettings = lazy(() => import('@/pages/projects/FormsSettings'));
const FormBuilderPage = lazy(() => import('@/pages/projects/FormBuilderPage'));

// In project settings:
<Route path="forms" element={<FormsSettings />} />
<Route path="forms/:formId" element={<FormBuilderPage />} />
```

Add nav link in project settings:
```tsx
<NavItem to={`/${org}/${team}/${project}/settings/forms`} icon={FileInput}>
  Forms
</NavItem>
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/projects/FormsSettings.tsx frontend/src/pages/projects/FormBuilderPage.tsx
git add <route-file> <sidebar-file>
git commit -m "feat(forms): add form settings and builder pages"
```

---

### Task 15: Typecheck and Final Verification

- [ ] **Step 1: Run backend typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run all tests**

Run: `npm run test`
Expected: All pass.

- [ ] **Step 4: Run full check**

Run: `npm run check`
Expected: All pass.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(forms): resolve typecheck and lint issues"
```
