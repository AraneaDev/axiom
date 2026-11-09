import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bot, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { ApiError } from '@/api/client';
import { serviceAccountError, serviceAccountsApi } from '@/api/service-accounts.api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { Table, TableContainer, Tbody, Td, Th, Thead, Tr, TrHead } from '@/components/ui/Table';
import { Textarea } from '@/components/ui/Textarea';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { formatRelative } from '@/lib/utils';

import { ServiceAccountStatusBadge, useOrgOfPage } from './service-account-shared';
import { ServiceAccountOwnerPicker } from './ServiceAccountOwnerPicker';

const HELP = [
  {
    title: 'A bot is its own user',
    description:
      'A service account runs on a schedule outside Axiom with its own name, memberships and tokens. Everything it does is recorded under its name.',
  },
  {
    title: 'Owners answer for it',
    description:
      'Its owners decide its requests, manage its tokens and can suspend it. A bot with no owner left is suspended until it gets one.',
  },
  {
    title: 'Who sees what',
    description:
      'Org owners and admins see every bot and create new ones. An owner sees the bots they own.',
  },
];

/**
 * The service accounts (bots) of an org: all of them for an org admin, the viewer's own for an
 * owner. Org admins create new ones here.
 */
export default function ServiceAccounts() {
  const { slug, org, isAdmin, isLoading: loadingOrg } = useOrgOfPage();
  const [creating, setCreating] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['service-accounts', org?.id],
    queryFn: () => serviceAccountsApi.list(org?.id ?? ''),
    enabled: !!org,
  });

  // The server refuses a member who owns no bot: for them there is simply nothing here
  const ownsNone = error instanceof ApiError && error.status === 403;

  return (
    <SettingsPage
      title="Service accounts"
      description={org ? `Bots that act in ${org.name} on their own` : undefined}
      icon={Bot}
      helpItems={HELP}
      actions={
        isAdmin && org ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New service account
          </Button>
        ) : undefined
      }
    >
      {loadingOrg || (org && isLoading) ? (
        <TableSkeleton rows={3} cols={5} />
      ) : !org ? (
        <EmptyState
          icon={<AlertTriangle />}
          title="Org not available"
          description="The org does not exist, or you are not a member."
        />
      ) : ownsNone ? (
        <EmptyState
          icon={<Bot />}
          title="No service accounts for you here"
          description="You own no bot in this org. Org owners and admins create them."
        />
      ) : error ? (
        <ErrorAlert error={error} fallback="Could not load the service accounts" />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={<Bot />}
          title="No service accounts yet"
          description={
            isAdmin
              ? 'Create one for a bot that runs on a schedule outside Axiom.'
              : 'Org owners and admins create them.'
          }
        />
      ) : (
        <TableContainer>
          <Table>
            <Thead>
              <TrHead>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>Owners</Th>
                <Th>Teams</Th>
                <Th>Last active</Th>
              </TrHead>
            </Thead>
            <Tbody>
              {data.map((bot) => (
                <Tr key={bot.id}>
                  <Td>
                    <Link
                      to={`/${slug}/settings/service-accounts/${bot.id}`}
                      className="font-medium text-text hover:text-primary transition-colors"
                    >
                      {bot.displayName}
                    </Link>
                    <p className="text-xs text-text-tertiary">@{bot.username}</p>
                  </Td>
                  <Td>
                    <ServiceAccountStatusBadge bot={bot} />
                  </Td>
                  <Td className="text-sm text-text-secondary">
                    {bot.owners.length === 0 ? (
                      <span className="text-text-tertiary">None</span>
                    ) : (
                      <ul>
                        {bot.owners.map((o) => (
                          <li key={o.id}>{o.displayName}</li>
                        ))}
                      </ul>
                    )}
                  </Td>
                  <Td className="text-sm text-text-secondary">
                    {bot.teams.length === 0 ? (
                      <span className="text-text-tertiary">None</span>
                    ) : (
                      <ul>
                        {bot.teams.map((t) => (
                          <li key={t.id}>{t.name}</li>
                        ))}
                      </ul>
                    )}
                  </Td>
                  <Td className="text-sm text-text-secondary whitespace-nowrap">
                    {bot.lastUsedAt ? formatRelative(bot.lastUsedAt) : 'Never'}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </TableContainer>
      )}

      {org && isAdmin && (
        <CreateServiceAccountModal
          open={creating}
          orgId={org.id}
          orgSlug={slug}
          onClose={() => setCreating(false)}
        />
      )}
    </SettingsPage>
  );
}

interface CreateServiceAccountModalProps {
  open: boolean;
  orgId: string;
  orgSlug: string;
  onClose: () => void;
}

/**
 * Create a bot: its username, display name, description and owners.
 * @param props - The dialog state and the org
 * @param props.open - Whether the dialog shows
 * @param props.orgId - The org the bot is made in
 * @param props.orgSlug - The org's slug, for the bot's page
 * @param props.onClose - Close the dialog
 */
function CreateServiceAccountModal({
  open,
  orgId,
  orgSlug,
  onClose,
}: CreateServiceAccountModalProps) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [ownerIds, setOwnerIds] = useState<string[]>([]);

  const create = useMutationWithToast(
    () =>
      serviceAccountsApi.create(orgId, {
        username: username.trim(),
        displayName: displayName.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ownerIds,
      }),
    {
      successMessage: 'Service account created',
      errorMessage: null,
      invalidateKeys: [['service-accounts', orgId]],
      onSuccess: (bot) => {
        close();
        navigate(`/${orgSlug}/settings/service-accounts/${bot.id}`);
      },
    },
  );

  function close() {
    setUsername('');
    setDisplayName('');
    setDescription('');
    setOwnerIds([]);
    create.reset();
    onClose();
  }

  const ready = username.trim() !== '' && displayName.trim() !== '' && ownerIds.length > 0;

  return (
    <Modal open={open} onClose={close} title="New service account">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) create.mutate();
        }}
      >
        <Input
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          hint="Letters, digits, dashes and underscores. It can't sign in."
          autoFocus
        />
        <Input
          label="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Textarea
          id="service-account-description"
          label="Description"
          value={description}
          maxLength={500}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
          hint="What it does and where it runs."
        />
        <ServiceAccountOwnerPicker orgId={orgId} selected={ownerIds} onChange={setOwnerIds} />
        {create.error && (
          <ErrorAlert error={new Error(serviceAccountError(create.error))} fallback="" />
        )}
        <ModalFooter>
          <Button type="button" variant="secondary" size="sm" onClick={close}>
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!ready || create.isPending}>
            <Plus className="h-3.5 w-3.5" /> Create
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
