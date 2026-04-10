import { get, post, patch, del } from './client';

export interface ApprovalGate {
  id: string;
  projectId: string;
  fromColumnId: string;
  toColumnId: string;
  fromColumn: { id: string; name: string; position: number };
  toColumn: { id: string; name: string; position: number };
  minApprovals: number;
  allowSelfApproval: boolean;
  enabled: boolean;
}

export interface ApprovalVote {
  id: string;
  userId: string;
  user: { id: string; username: string; displayName: string; avatarUrl: string | null };
  decision: 'APPROVED' | 'REJECTED';
  comment: string | null;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  issueId: string;
  approvalGateId: string;
  targetColumnId: string;
  targetColumn: { id: string; name: string; position: number };
  requestedById: string;
  requestedBy: { id: string; username: string; displayName: string; avatarUrl: string | null };
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  createdAt: string;
  resolvedAt: string | null;
  votes: ApprovalVote[];
  issue?: { id: string; number: number; title: string };
  approvalGate?: ApprovalGate;
}

/** Approval workflows API client for gates, requests, voting, and personal approvals. */
export const approvalsApi = {
  // Gates
  listGates: (projectId: string) => get<ApprovalGate[]>(`/projects/${projectId}/approval-gates`),

  createGate: (
    projectId: string,
    data: {
      fromColumnId: string;
      toColumnId: string;
      minApprovals?: number;
      allowSelfApproval?: boolean;
      enabled?: boolean;
    },
  ) => post<ApprovalGate>(`/projects/${projectId}/approval-gates`, data),

  updateGate: (
    projectId: string,
    gateId: string,
    data: {
      minApprovals?: number;
      allowSelfApproval?: boolean;
      enabled?: boolean;
    },
  ) => patch<ApprovalGate>(`/projects/${projectId}/approval-gates/${gateId}`, data),

  deleteGate: (projectId: string, gateId: string) =>
    del(`/projects/${projectId}/approval-gates/${gateId}`),

  // Requests
  createRequest: (issueId: string, data: { targetColumnId: string; approverIds: string[] }) =>
    post<ApprovalRequest>(`/issues/${issueId}/approval-requests`, data),

  listRequestsForIssue: (issueId: string) =>
    get<ApprovalRequest[]>(`/issues/${issueId}/approval-requests`),

  listPendingForProject: (projectId: string) =>
    get<ApprovalRequest[]>(`/projects/${projectId}/approval-requests/pending`),

  // Voting
  castVote: (requestId: string, data: { decision: 'APPROVED' | 'REJECTED'; comment?: string }) =>
    post<ApprovalVote>(`/approval-requests/${requestId}/votes`, data),

  cancelRequest: (requestId: string) =>
    patch<ApprovalRequest>(`/approval-requests/${requestId}/cancel`, {}),

  // My approvals
  myPendingApprovals: () => get<ApprovalRequest[]>('/approval-requests/my-pending'),
};
