import { get, post, patch, del } from './client';

export interface FormField {
  id: string;
  formPageId: string;
  type: string;
  label: string;
  placeholder?: string | null;
  helpText?: string | null;
  required: boolean;
  position: number;
  options?: { label: string; value: string }[] | null;
  issueFieldMapping?: string | null;
  validationRules?: { minLength?: number; maxLength?: number; pattern?: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface FormPage {
  id: string;
  formId: string;
  title: string;
  position: number;
  conditionFieldId?: string | null;
  conditionOperator?: string | null;
  conditionValue?: string | null;
  conditionField?: { id: string; label: string; type: string } | null;
  fields: FormField[];
}

export interface Form {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  description?: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  authMode: 'PUBLIC' | 'TOKEN_GATED';
  sharedSecret?: string | null;
  spamProtection: 'NONE' | 'CAPTCHA' | 'RATE_LIMIT';
  rateLimitPerHour?: number | null;
  successMessage?: string | null;
  redirectUrl?: string | null;
  pages: FormPage[];
  _count?: { submissions: number; pages: number };
  createdAt: string;
  updatedAt: string;
}

export const formsApi = {
  /**
   * List all forms for a project.
   * @param projectId
   */
  list: (projectId: string) => get<Form[]>(`/projects/${projectId}/forms`),

  /**
   * Get a single form by ID.
   * @param projectId
   * @param formId
   */
  get: (projectId: string, formId: string) => get<Form>(`/projects/${projectId}/forms/${formId}`),

  /**
   * Create a new form.
   * @param projectId
   * @param data
   * @param data.title
   * @param data.name
   * @param data.slug
   * @param data.description
   */
  create: (projectId: string, data: { name: string; slug: string; description?: string }) =>
    post<Form>(`/projects/${projectId}/forms`, data),

  /**
   * Update a form's metadata.
   * @param projectId
   * @param formId
   * @param data
   */
  update: (
    projectId: string,
    formId: string,
    data: Partial<{
      name: string;
      slug: string;
      description: string;
      authMode: 'PUBLIC' | 'TOKEN_GATED';
      sharedSecret: string;
      spamProtection: 'NONE' | 'CAPTCHA' | 'RATE_LIMIT';
      rateLimitPerHour: number;
      successMessage: string;
      redirectUrl: string;
    }>,
  ) => patch<Form>(`/projects/${projectId}/forms/${formId}`, data),

  /**
   * Delete a form.
   * @param projectId
   * @param formId
   */
  delete: (projectId: string, formId: string) => del(`/projects/${projectId}/forms/${formId}`),

  /**
   * Toggle publish state of a form.
   * @param projectId
   * @param formId
   */
  publish: (projectId: string, formId: string) =>
    patch<Form>(`/projects/${projectId}/forms/${formId}/publish`, {}),

  // ─── Pages ───────────────────────────────────────────────────

  /**
   * Add a new page to a form.
   * @param projectId
   * @param formId
   * @param data
   * @param data.title
   */
  createPage: (projectId: string, formId: string, data: { title: string }) =>
    post<FormPage>(`/projects/${projectId}/forms/${formId}/pages`, data),

  /**
   * Update a page's metadata or branching config.
   * @param projectId
   * @param formId
   * @param pageId
   * @param data
   */
  updatePage: (
    projectId: string,
    formId: string,
    pageId: string,
    data: Partial<{
      title: string;
      conditionFieldId: string | null;
      conditionOperator: string | null;
      conditionValue: string | null;
    }>,
  ) => patch<FormPage>(`/projects/${projectId}/forms/${formId}/pages/${pageId}`, data),

  /**
   * Delete a page from a form.
   * @param projectId
   * @param formId
   * @param pageId
   */
  deletePage: (projectId: string, formId: string, pageId: string) =>
    del(`/projects/${projectId}/forms/${formId}/pages/${pageId}`),

  /**
   * Reorder pages in a form.
   * @param projectId
   * @param formId
   * @param positions
   * @param pageIds
   */
  reorderPages: (projectId: string, formId: string, pageIds: string[]) =>
    post<FormPage[]>(`/projects/${projectId}/forms/${formId}/pages/reorder`, { pageIds }),

  // ─── Fields ──────────────────────────────────────────────────

  /**
   * Add a field to a page.
   * @param projectId
   * @param formId
   * @param pageId
   * @param data
   */
  createField: (
    projectId: string,
    formId: string,
    pageId: string,
    data: Partial<FormField> & { type: string; label: string },
  ) => post<FormField>(`/projects/${projectId}/forms/${formId}/pages/${pageId}/fields`, data),

  /**
   * Update a field's config.
   * @param projectId
   * @param formId
   * @param pageId
   * @param fieldId
   * @param data
   */
  updateField: (
    projectId: string,
    formId: string,
    pageId: string,
    fieldId: string,
    data: Partial<FormField>,
  ) =>
    patch<FormField>(
      `/projects/${projectId}/forms/${formId}/pages/${pageId}/fields/${fieldId}`,
      data,
    ),

  /**
   * Delete a field.
   * @param projectId
   * @param formId
   * @param pageId
   * @param fieldId
   */
  deleteField: (projectId: string, formId: string, pageId: string, fieldId: string) =>
    del(`/projects/${projectId}/forms/${formId}/pages/${pageId}/fields/${fieldId}`),

  /**
   * Reorder fields across a form (flat list with pageId per item).
   * @param projectId
   * @param formId
   * @param positions
   * @param fieldIds
   */
  reorderFields: (projectId: string, formId: string, fieldIds: string[]) =>
    post<FormField[]>(`/projects/${projectId}/forms/${formId}/fields/reorder`, { fieldIds }),

  // ─── Public ──────────────────────────────────────────────────

  /**
   * Fetch a published form by its slug (no auth).
   * @param slug
   */
  getPublic: (slug: string) => get<Form>(`/f/${slug}`),

  /**
   * Submit a response to a public form (no auth).
   * @param slug
   * @param data
   * @param data.responses
   * @param data.honeypot
   */
  submit: (slug: string, data: { responses: Record<string, unknown>; honeypot?: string }) =>
    post<{ submissionId: string }>(`/f/${slug}/submit`, data),

  /**
   * Verify access to a password-protected form.
   * @param slug
   * @param secret
   */
  verify: (slug: string, secret: string) =>
    post<{ token: string }>(`/f/${slug}/verify`, { secret }),
};
