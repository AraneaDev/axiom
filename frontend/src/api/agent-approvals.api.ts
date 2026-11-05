import { get, post } from './client';

export type AgentApprovalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'EXECUTED'
  | 'FAILED';

/** A request in the list: what it holds (input, result) comes with the detail. */
export interface AgentApprovalSummary {
  id: string;
  action: string;
  preview: string;
  status: AgentApprovalStatus;
  apiTokenName: string | null;
  channel: string;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface AgentApprovalError {
  status?: number;
  code?: string;
  message?: string;
}

export interface AgentApproval extends AgentApprovalSummary {
  userId: string;
  input: unknown;
  result: unknown;
  error: AgentApprovalError | null;
}

interface ListResult {
  data: AgentApprovalSummary[];
  total: number;
}

const BASE = '/agent-approvals';

/** Requests that agents made and wait for your decision. Only the web UI approves. */
export const agentApprovalsApi = {
  list: (params: { status?: AgentApprovalStatus; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    const text = query.toString();
    return get<ListResult>(text ? `${BASE}?${text}` : BASE);
  },
  get: (id: string) => get<AgentApproval>(`${BASE}/${encodeURIComponent(id)}`),
  approve: (id: string) => post<AgentApproval>(`${BASE}/${encodeURIComponent(id)}/approve`, {}),
  reject: (id: string) => post<AgentApproval>(`${BASE}/${encodeURIComponent(id)}/reject`, {}),
};
