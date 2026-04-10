import { get, post } from './client';

export interface FormSubmission {
  id: string;
  formId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SPAM';
  responses: Record<string, unknown>;
  submitterEmail?: string | null;
  submitterName?: string | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  reviewedById?: string | null;
  reviewedBy?: { id: string; username: string; displayName: string } | null;
  issueId?: string | null;
  issue?: { id: string; number: number; title: string } | null;
  form?: { id: string; title: string; slug: string } | null;
  createdAt: string;
  updatedAt: string;
}

export const intakeApi = {
  /**
   * List submissions for a project with optional status filter and pagination.
   * @param projectId
   * @param params
   * @param params.status
   * @param params.limit
   * @param params.offset
   */
  list: (projectId: string, params?: { status?: string; limit?: number; offset?: number }) => {
    const query = params
      ? '?' +
        new URLSearchParams(
          Object.fromEntries(
            Object.entries(params)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, String(v)]),
          ),
        ).toString()
      : '';
    return get<{ submissions: FormSubmission[]; total: number }>(
      `/projects/${projectId}/intake${query}`,
    );
  },

  /**
   * Get a single submission by ID.
   * @param projectId
   * @param submissionId
   */
  get: (projectId: string, submissionId: string) =>
    get<FormSubmission>(`/projects/${projectId}/intake/${submissionId}`),

  /**
   * Approve a submission and optionally create an issue.
   * @param projectId
   * @param submissionId
   * @param data
   * @param data.title
   * @param data.body
   * @param data.type
   * @param data.priority
   * @param data.assigneeId
   * @param data.labels
   */
  approve: (
    projectId: string,
    submissionId: string,
    data?: {
      title?: string;
      body?: string;
      type?: string;
      priority?: string;
      assigneeId?: string;
      labels?: string[];
    },
  ) =>
    post<{ submission: FormSubmission; issue?: { id: string; number: number; title: string } }>(
      `/projects/${projectId}/intake/${submissionId}/approve`,
      data ?? {},
    ),

  /**
   * Reject a submission with an optional review note.
   * @param projectId
   * @param submissionId
   * @param reviewNote
   */
  reject: (projectId: string, submissionId: string, reviewNote?: string) =>
    post<FormSubmission>(`/projects/${projectId}/intake/${submissionId}/reject`, {
      reviewNote,
    }),

  /**
   * Mark a submission as spam.
   * @param projectId
   * @param submissionId
   */
  spam: (projectId: string, submissionId: string) =>
    post<FormSubmission>(`/projects/${projectId}/intake/${submissionId}/spam`, {}),
};
