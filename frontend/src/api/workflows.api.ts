import { get, post, patch, del } from './client';

export interface WorkflowRule {
  id: string;
  projectId: string;
  fromColumnId: string;
  toColumnId: string;
  fromColumn: { id: string; name: string };
  toColumn: { id: string; name: string };
  createdAt: string;
}

export interface AutomationCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'in' | 'not_in' | 'contains';
  value?: string;
  values?: string[];
}

export interface AutomationAction {
  type: 'set_status' | 'set_assignee' | 'add_label' | 'add_comment';
  columnId?: string;
  userId?: string;
  name?: string;
  body?: string;
}

export interface AutomationRule {
  id: string;
  projectId: string;
  name: string;
  trigger: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  enabled: boolean;
  createdAt: string;
}

export const workflowsApi = {
  listRules: (projectId: string) => get<WorkflowRule[]>(`/projects/${projectId}/workflow-rules`),
  createRule: (projectId: string, data: { fromColumnId: string; toColumnId: string }) =>
    post<WorkflowRule>(`/projects/${projectId}/workflow-rules`, data),
  deleteRule: (projectId: string, ruleId: string) =>
    del(`/projects/${projectId}/workflow-rules/${ruleId}`),
};

export const automationApi = {
  listRules: (projectId: string) =>
    get<AutomationRule[]>(`/projects/${projectId}/automation-rules`),
  createRule: (
    projectId: string,
    data: {
      name: string;
      trigger: string;
      conditions: AutomationCondition[];
      actions: AutomationAction[];
      enabled?: boolean;
    },
  ) => post<AutomationRule>(`/projects/${projectId}/automation-rules`, data),
  updateRule: (projectId: string, ruleId: string, data: Partial<AutomationRule>) =>
    patch<AutomationRule>(`/projects/${projectId}/automation-rules/${ruleId}`, data),
  deleteRule: (projectId: string, ruleId: string) =>
    del(`/projects/${projectId}/automation-rules/${ruleId}`),
  toggleRule: (projectId: string, ruleId: string) =>
    post<AutomationRule>(`/projects/${projectId}/automation-rules/${ruleId}/toggle`, {}),
};
