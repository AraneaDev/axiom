import { get, post, patch, del, api } from './client';

export interface CustomFieldDefinition {
  id: string;
  projectId: string;
  name: string;
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'MULTI_SELECT' | 'USER';
  options: string[] | null;
  required: boolean;
  position: number;
}

export interface CustomFieldValue {
  id: string;
  issueId: string;
  fieldDefinitionId: string;
  value: string;
  fieldDefinition: CustomFieldDefinition;
}

export const customFieldsApi = {
  // Definitions
  listDefinitions: (projectId: string) =>
    get<CustomFieldDefinition[]>(`/projects/${projectId}/custom-fields`),

  createDefinition: (
    projectId: string,
    data: { name: string; type: string; options?: string[]; required?: boolean; position?: number },
  ) => post<CustomFieldDefinition>(`/projects/${projectId}/custom-fields`, data),

  updateDefinition: (
    fieldId: string,
    data: { name?: string; options?: string[]; required?: boolean; position?: number },
  ) => patch<CustomFieldDefinition>(`/custom-fields/${fieldId}`, data),

  deleteDefinition: (fieldId: string) => del(`/custom-fields/${fieldId}`),

  // Values
  getFieldValues: (issueId: string) => get<CustomFieldValue[]>(`/issues/${issueId}/custom-fields`),

  setFieldValue: (issueId: string, fieldId: string, value: string) =>
    api<CustomFieldValue>(`/issues/${issueId}/custom-fields/${fieldId}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
};
