import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  customFieldsApi,
  type CustomFieldDefinition,
  type CustomFieldValue,
} from '@/api/custom-fields.api';
import { CustomFieldRenderer } from '@/components/CustomFieldRenderer';
import { Spinner } from '@/components/ui/Spinner';

interface TeamMember {
  user: { id: string; displayName: string };
}

interface CustomFieldEditorProps {
  issueId: string;
  projectId: string;
  teamMembers: TeamMember[] | undefined;
}

/**
 *
 * @param root0
 * @param root0.issueId
 * @param root0.projectId
 * @param root0.teamMembers
 */
export function CustomFieldEditor({ issueId, projectId, teamMembers }: CustomFieldEditorProps) {
  const queryClient = useQueryClient();

  const { data: customFieldDefs = [] } = useQuery({
    queryKey: ['custom-fields', projectId],
    queryFn: () => customFieldsApi.listDefinitions(projectId),
    enabled: !!projectId,
  });

  const { data: customFieldValues = [] } = useQuery({
    queryKey: ['custom-field-values', issueId],
    queryFn: () => customFieldsApi.getFieldValues(issueId),
    enabled: !!issueId,
  });

  const setFieldValueMutation = useMutation({
    mutationFn: ({ fieldId, value }: { fieldId: string; value: string }) =>
      customFieldsApi.setFieldValue(issueId, fieldId, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-field-values', issueId] });
    },
  });

  if (customFieldDefs.length === 0) return null;

  return (
    <div className="border-t border-border-light pt-3 mt-4">
      <p className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-2 flex items-center gap-1.5">
        Custom Fields
        {setFieldValueMutation.isPending && <Spinner size="xs" />}
      </p>
      <div className="space-y-2">
        {customFieldDefs.map((def: CustomFieldDefinition) => {
          const fieldValue = customFieldValues.find(
            (v: CustomFieldValue) => v.fieldDefinitionId === def.id,
          );
          return (
            <div key={def.id}>
              <p className="text-xs text-text-tertiary mb-0.5">{def.name}</p>
              <CustomFieldRenderer
                definition={def}
                value={fieldValue?.value}
                onChange={(value) => setFieldValueMutation.mutate({ fieldId: def.id, value })}
                teamMembers={teamMembers}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
