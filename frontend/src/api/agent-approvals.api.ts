import { get, post } from './client';

export type AgentApprovalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'EXECUTED'
  | 'FAILED'
  | 'CANCELLED';

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
  /** The bot that asked, on a request of a service account the reader owns */
  serviceAccount?: { id: string; displayName: string };
  /** A bot's request in a place the reader can't open: no preview of its own, and no decision */
  restricted?: true;
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

/** Requests that agents made and wait for your decision. Only the web UI approves. */
export const agentApprovalsApi = {
  list: (
    params: {
      status?: AgentApprovalStatus;
      state?: 'open' | 'decided';
      limit?: number;
      offset?: number;
    } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.status) search.set('status', params.status);
    if (params.state) search.set('state', params.state);
    if (params.limit !== undefined) search.set('limit', String(params.limit));
    if (params.offset !== undefined) search.set('offset', String(params.offset));
    const query = search.size > 0 ? '?' + search.toString() : '';
    return get<ListResult>(`/agent-approvals${query}`);
  },
  get: (id: string) => get<AgentApproval>(`/agent-approvals/${encodeURIComponent(id)}`),
  approve: (id: string) =>
    post<AgentApproval>(`/agent-approvals/${encodeURIComponent(id)}/approve`, {}),
  reject: (id: string) =>
    post<AgentApproval>(`/agent-approvals/${encodeURIComponent(id)}/reject`, {}),
};
