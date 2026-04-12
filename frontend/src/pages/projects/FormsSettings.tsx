import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Copy,
  Edit,
  ExternalLink,
  FileInput,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { formsApi, type Form } from '@/api/forms.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { Table, TableContainer, Tbody, Td, Th, Thead, TrHead } from '@/components/ui/Table';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useProjectContext } from '@/hooks/useProjectContext';

/**
 * Project settings page for managing public intake forms.
 * Lists all forms with create/edit/publish/delete actions.
 */
export default function FormsSettings() {
  const { currentProject, basePath } = useProjectContext();
  const navigate = useNavigate();

  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createSlug, setCreateSlug] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const {
    data: forms,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['forms', currentProject?.id],
    queryFn: () => formsApi.list(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const createMutation = useMutationWithToast(
    (data: { name: string; slug: string }) => formsApi.create(currentProject!.id, data),
    {
      successMessage: 'Form created',
      invalidateKeys: [['forms', currentProject?.id]],
      onSuccess: (form) => {
        setCreateOpen(false);
        setCreateTitle('');
        setCreateSlug('');
        navigate(`${basePath}/settings/forms/${form.id}`);
      },
    },
  );

  const deleteMutation = useMutationWithToast(
    (formId: string) => formsApi.delete(currentProject!.id, formId),
    {
      successMessage: 'Form deleted',
      invalidateKeys: [['forms', currentProject?.id]],
      onSuccess: () => setDeleteTarget(null),
    },
  );

  const publishMutation = useMutationWithToast(
    (formId: string) => formsApi.publish(currentProject!.id, formId),
    {
      successMessage: 'Form publish status toggled',
      invalidateKeys: [['forms', currentProject?.id]],
    },
  );

  function handleCreateSubmit() {
    if (!createTitle.trim() || !createSlug.trim()) return;
    createMutation.mutate({ name: createTitle.trim(), slug: createSlug.trim() });
  }

  if (isLoading) return <ListSkeleton rows={4} />;

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-text-secondary">Failed to load forms</p>
        </div>
      </div>
    );
  }

  return (
    <SettingsPage
      title="Intake Forms"
      description="Create and manage public intake forms that external users can submit"
      icon={FileInput}
      helpTitle="Intake Forms"
      helpItems={[
        {
          title: 'Public forms',
          description:
            'Each form gets a unique public URL. Anyone with the link can submit responses.',
        },
        {
          title: 'Issue mapping',
          description:
            'Map form fields to issue properties (title, description, type, priority) so submissions can be converted to issues.',
        },
        {
          title: 'Review queue',
          description: 'Submissions appear in the Intake Queue for review before becoming issues.',
        },
      ]}
    >
      <div className="flex justify-end mb-4">
        <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New Form
        </Button>
      </div>

      {forms && forms.length > 0 ? (
        <TableContainer>
          <Table>
            <Thead>
              <TrHead>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>Submissions</Th>
                <Th>Public URL</Th>
                <Th className="text-right">Actions</Th>
              </TrHead>
            </Thead>
            <Tbody>
              {forms.map((form: Form) => (
                <tr key={form.id}>
                  <Td className="font-medium text-text">{form.name}</Td>
                  <Td>
                    <Badge variant={form.status === 'PUBLISHED' ? 'success' : 'default'}>
                      {form.status === 'PUBLISHED' ? 'Published' : 'Draft'}
                    </Badge>
                  </Td>
                  <Td className="text-text-secondary">{form._count?.submissions ?? 0}</Td>
                  <Td>
                    <span className="text-[12px] text-text-tertiary font-mono">/f/{form.slug}</span>
                    {form.status === 'PUBLISHED' && (
                      <a
                        href={`/f/${form.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex ml-1"
                        title="Open public form"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-primary" />
                      </a>
                    )}
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => navigate(`${basePath}/settings/forms/${form.id}`)}
                        title="Edit form"
                      >
                        <Edit className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => publishMutation.mutate(form.id)}
                        disabled={publishMutation.isPending}
                        title={form.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                      >
                        <Send className="h-3.5 w-3.5" />
                        {form.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/f/${form.slug}`);
                        }}
                        title="Copy public URL"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setDeleteTarget(form.id)}
                        title="Delete form"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        </TableContainer>
      ) : (
        <EmptyState
          card
          icon={<FileInput className="h-10 w-10" />}
          title="No intake forms yet"
          description="Create a form to start collecting submissions from external users."
        />
      )}

      {/* Create Form Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Intake Form">
        <div className="space-y-4">
          <Input
            label="Form Name"
            value={createTitle}
            onChange={(e) => {
              setCreateTitle(e.target.value);
              // Auto-generate slug from title
              setCreateSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-|-$/g, ''),
              );
            }}
            placeholder="Bug Report Form"
          />
          <Input
            label="URL Slug"
            value={createSlug}
            onChange={(e) => setCreateSlug(e.target.value)}
            placeholder="bug-report"
          />
          <p className="text-[12px] text-text-tertiary">
            Public URL will be: {window.location.origin}/f/{createSlug || 'your-slug'}
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!createTitle.trim() || !createSlug.trim() || createMutation.isPending}
              onClick={handleCreateSubmit}
            >
              <Plus className="h-4 w-4" /> Create Form
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Form"
        description="This will permanently delete the form and all its submissions. This action cannot be undone."
        confirmLabel="Delete Form"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </SettingsPage>
  );
}
