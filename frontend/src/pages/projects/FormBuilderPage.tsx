import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';

import { formsApi } from '@/api/forms.api';
import { Button } from '@/components/ui/Button';
import { FormBuilder } from '@/components/ui/FormBuilder';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useProjectContext } from '@/hooks/useProjectContext';

/**
 * Wrapper page for the FormBuilder component.
 * Fetches form data and wires up all CRUD mutations for pages and fields.
 */
export default function FormBuilderPage() {
  const { formId } = useParams<{ formId: string }>();
  const { currentProject, basePath } = useProjectContext();
  const navigate = useNavigate();

  const projectId = currentProject?.id ?? '';

  const {
    data: form,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['form', formId],
    queryFn: () => formsApi.get(projectId, formId!),
    enabled: !!projectId && !!formId,
  });

  const invalidateKeys = [['form', formId] as const];

  const addPageMutation = useMutationWithToast(
    () => formsApi.createPage(projectId, formId!, { title: 'New Page' }),
    { successMessage: 'Page added', invalidateKeys },
  );

  const updatePageMutation = useMutationWithToast(
    (vars: { pageId: string; data: Parameters<typeof formsApi.updatePage>[3] }) =>
      formsApi.updatePage(projectId, formId!, vars.pageId, vars.data),
    { successMessage: null, invalidateKeys },
  );

  const deletePageMutation = useMutationWithToast(
    (pageId: string) => formsApi.deletePage(projectId, formId!, pageId),
    { successMessage: 'Page deleted', invalidateKeys },
  );

  const addFieldMutation = useMutationWithToast(
    (pageId: string) =>
      formsApi.createField(projectId, formId!, pageId, {
        type: 'TEXT',
        label: 'New Field',
      }),
    { successMessage: 'Field added', invalidateKeys },
  );

  const updateFieldMutation = useMutationWithToast(
    (vars: { pageId: string; fieldId: string; data: Parameters<typeof formsApi.updateField>[4] }) =>
      formsApi.updateField(projectId, formId!, vars.pageId, vars.fieldId, vars.data),
    { successMessage: null, invalidateKeys },
  );

  const deleteFieldMutation = useMutationWithToast(
    (vars: { pageId: string; fieldId: string }) =>
      formsApi.deleteField(projectId, formId!, vars.pageId, vars.fieldId),
    { successMessage: 'Field deleted', invalidateKeys },
  );

  const publishMutation = useMutationWithToast(() => formsApi.publish(projectId, formId!), {
    successMessage: 'Form publish status toggled',
    invalidateKeys,
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <ListSkeleton rows={6} />
      </div>
    );
  }

  if (error || !form) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-text-secondary">Failed to load form</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(`${basePath}/settings/forms`)}>
          <ArrowLeft className="h-4 w-4" /> Back to Forms
        </Button>
      </div>

      <FormBuilder
        form={form}
        onAddPage={() => addPageMutation.mutate()}
        onUpdatePage={(pageId, data) => updatePageMutation.mutate({ pageId, data })}
        onDeletePage={(pageId) => deletePageMutation.mutate(pageId)}
        onAddField={(pageId) => addFieldMutation.mutate(pageId)}
        onUpdateField={(pageId, fieldId, data) =>
          updateFieldMutation.mutate({ pageId, fieldId, data })
        }
        onDeleteField={(pageId, fieldId) => deleteFieldMutation.mutate({ pageId, fieldId })}
        onPreview={() => window.open(`/f/${form.slug}`, '_blank')}
        onPublish={() => publishMutation.mutate()}
      />
    </div>
  );
}
