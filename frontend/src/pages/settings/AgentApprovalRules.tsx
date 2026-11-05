import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, Building2 } from 'lucide-react';
import { Link } from 'react-router';

import { agentPolicyApi } from '@/api/agent-policy.api';
import { orgsApi } from '@/api/orgs.api';
import { AgentPolicyForm } from '@/components/settings/AgentPolicyForm';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { Skeleton } from '@/components/ui/Skeleton';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';

/**
 * Your own rules for agent approvals. They can only make approval stricter than the org's.
 */
export default function AgentApprovalRules() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['agent-policy', 'user'],
    queryFn: agentPolicyApi.getUser,
  });
  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });

  const save = useMutationWithToast(
    (rules: Parameters<typeof agentPolicyApi.update>[0]['rules']) =>
      agentPolicyApi.update({ scope: 'user', rules }),
    {
      successMessage: 'Rules saved',
      onSuccess: (policy) => queryClient.setQueryData(['agent-policy', 'user'], policy),
    },
  );

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load your rules</p>
        </div>
      </div>
    );
  }

  const owned = (orgs ?? []).filter((org) => org.role === 'OWNER');

  return (
    <SettingsPage
      title="Agent approvals"
      description="Choose which actions an agent has to ask you about"
      icon={Bot}
      helpTitle="How the rules combine"
      helpItems={[
        {
          title: 'You can only tighten',
          description:
            'Your org sets the base rules. Yours add to them: a shorter expiry, a lower bulk threshold, more actions that wait. They never lift one.',
        },
        {
          title: 'Binding uploads takes three names',
          description:
            'Files come in three ways: attachment.upload (multipart), attachment.createUploadUrl and attachment.fromUrl. Add all three to make every upload wait or be refused.',
        },
        {
          title: 'Only you approve',
          description:
            'An agent asks, you decide in the web UI. Tokens and MCP clients never approve anything, and neither can they change these rules without your approval.',
        },
      ]}
    >
      <AgentPolicyForm
        key={JSON.stringify(data.rules)}
        scope="user"
        policy={data}
        canEdit
        saving={save.isPending}
        onSave={(rules) => save.mutate(rules)}
      />
      {owned.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-text">Org rules</h2>
          <p className="mb-2 text-xs text-text-secondary">
            You own these orgs, so you can set their base rules.
          </p>
          <ul className="space-y-1">
            {owned.map((org) => (
              <li key={org.id}>
                <Link
                  to={`/${org.slug}/settings/agent-approvals`}
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <Building2 className="h-3.5 w-3.5" /> {org.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SettingsPage>
  );
}
