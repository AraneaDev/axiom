import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot } from 'lucide-react';
import { useParams } from 'react-router';

import { agentPolicyApi } from '@/api/agent-policy.api';
import { orgsApi } from '@/api/orgs.api';
import { AgentPolicyForm } from '@/components/settings/AgentPolicyForm';
import { EmptyState } from '@/components/ui/EmptyState';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { Skeleton } from '@/components/ui/Skeleton';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';

/**
 * The base rules for agent approvals in an org. Members read them, only an owner changes them.
 */
export default function OrgAgentApprovals() {
  const { org: slug = '' } = useParams();
  const queryClient = useQueryClient();
  const { data: orgs, isLoading: loadingOrgs } = useQuery({
    queryKey: ['orgs'],
    queryFn: orgsApi.list,
  });
  const org = orgs?.find((o) => o.slug === slug);

  const { data, isLoading, error } = useQuery({
    queryKey: ['agent-policy', 'org', org?.id],
    queryFn: () => agentPolicyApi.getOrg(org?.id ?? ''),
    enabled: !!org,
  });

  const save = useMutationWithToast(
    (rules: Parameters<typeof agentPolicyApi.update>[0]['rules']) =>
      agentPolicyApi.update({ scope: 'org', orgId: org?.id, rules }),
    {
      successMessage: 'Rules saved',
      onSuccess: (policy) => queryClient.setQueryData(['agent-policy', 'org', org?.id], policy),
    },
  );

  if (loadingOrgs || (org && isLoading)) return <Skeleton className="h-64 w-full" />;
  if (!org || error || !data) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Rules not available"
        description="The org does not exist, or you are not a member."
      />
    );
  }

  const isOwner = org.role === 'OWNER';

  return (
    <SettingsPage
      title="Agent approvals"
      description={`The base rules for agents acting for members of ${org.name}`}
      icon={Bot}
      helpTitle="What the org decides"
      helpItems={[
        {
          title: 'Base rules',
          description:
            'These rules apply to every member, who can only make them stricter for themselves.',
        },
        {
          title: 'Admin actions always wait',
          description: 'No org rule lifts approval for admin actions, whatever it lists.',
        },
        ...(isOwner
          ? []
          : [
              {
                title: 'Read only',
                description: 'Only an owner of the org changes these rules.',
              },
            ]),
      ]}
    >
      <AgentPolicyForm
        key={JSON.stringify(data.rules)}
        scope="org"
        policy={data}
        canEdit={isOwner}
        saving={save.isPending}
        onSave={(rules) => save.mutate(rules)}
      />
    </SettingsPage>
  );
}
