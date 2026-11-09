import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Bot,
  Check,
  Clock,
  PauseCircle,
  Lock,
  Pencil,
  PlayCircle,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';

import { agentApprovalsApi } from '@/api/agent-approvals.api';
import {
  serviceAccountError,
  serviceAccountsApi,
  type ServiceAccountDetail as Detail,
} from '@/api/service-accounts.api';
import { spacePermissionsApi } from '@/api/space-permissions.api';
import { teamsApi } from '@/api/teams.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Select } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { Skeleton } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Textarea';
import { ViaLabel } from '@/components/ui/ViaLabel';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { formatDate, formatRelative } from '@/lib/utils';

import {
  isOrphaned,
  managesBots,
  ServiceAccountStatusBadge,
  useOrgOfPage,
} from './service-account-shared';
import { ServiceAccountOwnerPicker } from './ServiceAccountOwnerPicker';
import { ServiceAccountTokens } from './ServiceAccountTokens';

/** What an activity's action reads as, after the bot's name */
const ACTION_LABELS: Record<string, string> = {
  created: 'created',
  updated: 'updated',
  status_changed: 'changed the status of',
  assigned: 'assigned',
  unassigned: 'unassigned',
  commented: 'commented on',
  closed: 'closed',
  labeled: 'labeled',
  priority_changed: 'changed the priority of',
  type_changed: 'changed the type of',
  deleted: 'deleted',
  time_logged: 'logged time on',
};

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * One bot: its status, description, owners, memberships, tokens, waiting requests and recent
 * activity. Org admins change it; its owners read it and suspend or resume it.
 */
export default function ServiceAccountDetail() {
  const { id = '' } = useParams();
  const { slug: pageSlug, orgs, isPlatformAdmin } = useOrgOfPage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const key = ['service-account', id];

  const {
    data: bot,
    isLoading,
    error,
  } = useQuery({
    queryKey: key,
    queryFn: () => serviceAccountsApi.get(id),
    enabled: !!id,
  });

  // Rights and links follow the bot's own org, whatever org the address names
  const org = bot ? orgs?.find((o) => o.id === bot.orgId) : undefined;
  const slug = org?.slug ?? pageSlug;
  const isAdmin = managesBots(org?.role, isPlatformAdmin);

  const [confirm, setConfirm] = useState<'suspend' | 'resume' | 'delete' | null>(null);
  // The owners being edited, or null: "Add an owner" on an orphan opens the same editor
  const [ownersDraft, setOwnersDraft] = useState<string[] | null>(null);

  const onChanged = (next: Detail) => {
    queryClient.setQueryData<Detail>(key, next);
    // Other owners open other places: what the bot may join is read again
    void queryClient.invalidateQueries({ queryKey: ['service-account-joinable', id] });
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ['service-accounts'] });
  };
  const reload = () => void queryClient.invalidateQueries({ queryKey: key });

  // A refused action closes its dialog, so the reason shows on the page
  const closeOnError = () => setConfirm(null);
  const suspend = useMutationWithToast(() => serviceAccountsApi.suspend(id), {
    successMessage: 'Service account suspended',
    errorMessage: null,
    onSuccess: (next) => {
      setConfirm(null);
      onChanged(next);
    },
    onError: closeOnError,
  });
  const resume = useMutationWithToast(() => serviceAccountsApi.resume(id), {
    successMessage: 'Service account resumed',
    errorMessage: null,
    onSuccess: (next) => {
      setConfirm(null);
      onChanged(next);
    },
    onError: closeOnError,
  });
  const remove = useMutationWithToast(() => serviceAccountsApi.delete(id), {
    successMessage: 'Service account deleted',
    errorMessage: null,
    invalidateKeys: [['service-accounts']],
    onSuccess: () => {
      setConfirm(null);
      navigate(`/${slug}/settings/service-accounts`);
    },
    onError: closeOnError,
  });
  const actions = [suspend, resume, remove];
  // Each attempt clears what an earlier one left on the page
  const run = (action: (typeof actions)[number]) => {
    for (const other of actions) if (other !== action) other.reset();
    action.mutate();
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error || !bot) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Service account not available"
        description={serviceAccountError(error, 'It could not be loaded.')}
        action={
          <ButtonLink to={`/${slug}/settings/service-accounts`} variant="secondary" size="sm">
            <ArrowLeft className="h-3.5 w-3.5" /> Service accounts
          </ButtonLink>
        }
      />
    );
  }

  if (org && org.slug !== pageSlug) {
    return <Navigate to={`/${org.slug}/settings/service-accounts/${bot.id}`} replace />;
  }

  const orphaned = isOrphaned(bot);
  const suspended = bot.status === 'SUSPENDED';
  const actionError = suspend.error ?? resume.error ?? remove.error;

  return (
    <SettingsPage
      title={bot.displayName}
      description={`@${bot.username}, service account in ${org?.name ?? slug}`}
      icon={Bot}
      actions={
        <>
          <ButtonLink to={`/${slug}/settings/service-accounts`} variant="ghost" size="sm">
            <ArrowLeft className="h-3.5 w-3.5" /> All
          </ButtonLink>
          {/* An orphan suspended by hand stays suspended when it gets a new owner */}
          {(bot.status === 'ACTIVE' || orphaned) && (
            <Button variant="secondary" size="sm" onClick={() => setConfirm('suspend')}>
              <PauseCircle className="h-3.5 w-3.5" /> Suspend
            </Button>
          )}
          {suspended && !orphaned && (
            <Button variant="secondary" size="sm" onClick={() => setConfirm('resume')}>
              <PlayCircle className="h-3.5 w-3.5" /> Resume
            </Button>
          )}
          {isAdmin && (
            <Button variant="danger" size="sm" onClick={() => setConfirm('delete')}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6 min-w-0">
          <StatusCard
            bot={bot}
            onAddOwner={isAdmin ? () => setOwnersDraft(bot.owners.map((o) => o.id)) : undefined}
          />
          {actionError && (
            <ErrorAlert error={new Error(serviceAccountError(actionError))} fallback="" />
          )}
          <DescriptionCard bot={bot} isAdmin={isAdmin} onChanged={onChanged} />
          <ServiceAccountTokens bot={bot} />
          <ActivityCard botId={bot.id} />
        </div>
        <div className="flex flex-col gap-6 min-w-0">
          <OwnersCard
            bot={bot}
            isAdmin={isAdmin}
            draft={ownersDraft}
            onDraftChange={setOwnersDraft}
            onChanged={onChanged}
          />
          <MembershipsCard bot={bot} orgSlug={slug} canAdd={isAdmin} onAdded={reload} />
          <RequestsCard botId={bot.id} />
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'suspend'}
        onClose={() => setConfirm(null)}
        onConfirm={() => run(suspend)}
        loading={suspend.isPending}
        variant="warning"
        title={`Suspend ${bot.displayName}?`}
        description={
          orphaned
            ? 'It stays suspended when it gets a new owner, until someone resumes it.'
            : 'Its tokens stop working at once and its waiting requests are cancelled. Resume it to start it again.'
        }
        confirmLabel="Suspend"
      />
      <ConfirmDialog
        open={confirm === 'resume'}
        onClose={() => setConfirm(null)}
        onConfirm={() => run(resume)}
        loading={resume.isPending}
        variant="warning"
        title={`Resume ${bot.displayName}?`}
        description="Its tokens work again. Each team, space and page it is in needs an owner who can open it."
        confirmLabel="Resume"
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        onConfirm={() => run(remove)}
        loading={remove.isPending}
        title={`Delete ${bot.displayName}?`}
        description={
          `This removes its ${plural(bot.tokens.length, 'token')}, its place in ` +
          `${plural(bot.teams.length, 'team')} and ${plural(bot.spaces.length, 'space')}, ` +
          `its ${plural(bot.owners.length, 'owner')} and its waiting requests. Its past ` +
          'comments, issues and activity stay under its name.'
        }
        confirmLabel="Delete"
      />
    </SettingsPage>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function StatusCard({ bot, onAddOwner }: { bot: Detail; onAddOwner?: () => void }) {
  const orphaned = isOrphaned(bot);
  return (
    <Card className="flex flex-wrap items-center gap-3 p-5">
      <ServiceAccountStatusBadge bot={bot} />
      <p className="flex-1 text-sm text-text-secondary">
        {bot.status === 'ACTIVE'
          ? 'Its tokens work, within the rights of its memberships.'
          : orphaned
            ? 'It lost its last owner, so its tokens stop working. A new owner resumes it.'
            : `Suspended by hand${bot.suspendedAt ? ` on ${formatDate(bot.suspendedAt)}` : ''}. Its tokens stop working until it is resumed.`}
      </p>
      {orphaned && onAddOwner && (
        <Button size="sm" onClick={onAddOwner}>
          <UserPlus className="h-3.5 w-3.5" /> Add an owner
        </Button>
      )}
    </Card>
  );
}

function DescriptionCard({
  bot,
  isAdmin,
  onChanged,
}: {
  bot: Detail;
  isAdmin: boolean;
  onChanged: (next: Detail) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutationWithToast(
    (description: string) => serviceAccountsApi.update(bot.id, { description }),
    {
      successMessage: 'Description saved',
      errorMessage: null,
      onSuccess: (next) => {
        setDraft(null);
        onChanged(next);
      },
    },
  );

  return (
    <Section
      title="Description"
      action={
        isAdmin &&
        draft === null && (
          <Button variant="ghost" size="xs" onClick={() => setDraft(bot.description)}>
            <Pencil className="h-3.5 w-3.5" /> Edit description
          </Button>
        )
      }
    >
      {draft === null ? (
        <p className="whitespace-pre-wrap text-sm text-text-secondary">
          {bot.description || 'No description.'}
        </p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(draft);
          }}
        >
          <Textarea
            id="service-account-description-edit"
            label="Description"
            value={draft}
            maxLength={500}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
          />
          {save.error && (
            <ErrorAlert error={new Error(serviceAccountError(save.error))} fallback="" />
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setDraft(null)}>
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
            <Button type="submit" size="sm" disabled={save.isPending}>
              <Check className="h-3.5 w-3.5" /> Save description
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

function OwnersCard({
  bot,
  isAdmin,
  draft,
  onDraftChange: setDraft,
  onChanged,
}: {
  bot: Detail;
  isAdmin: boolean;
  draft: string[] | null;
  onDraftChange: (draft: string[] | null) => void;
  onChanged: (next: Detail) => void;
}) {
  const queryClient = useQueryClient();
  const save = useMutationWithToast(
    (ownerIds: string[]) => serviceAccountsApi.setOwners(bot.id, ownerIds),
    {
      successMessage: 'Owners saved',
      errorMessage: null,
      onSuccess: (next) => {
        setDraft(null);
        onChanged(next);
      },
      // Refused: read the owners again, so the list shows what the server holds; the editor
      // keeps the draft to fix
      onError: () => void queryClient.invalidateQueries({ queryKey: ['service-account', bot.id] }),
    },
  );

  return (
    <Section
      title="Owners"
      action={
        isAdmin &&
        draft === null && (
          <Button variant="ghost" size="xs" onClick={() => setDraft(bot.owners.map((o) => o.id))}>
            <Users className="h-3.5 w-3.5" /> Edit owners
          </Button>
        )
      }
    >
      <div data-testid="owners">
        {bot.owners.length === 0 ? (
          <p className="text-sm text-danger">No owner. The bot stays suspended until it has one.</p>
        ) : (
          <ul className="space-y-1">
            {bot.owners.map((o) => (
              <li key={o.id} className="text-sm text-text">
                <span>{o.displayName}</span>{' '}
                <span className="text-xs text-text-tertiary">@{o.username}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {draft !== null && (
        <form
          className="mt-4 space-y-3 border-t border-border-light pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(draft);
          }}
        >
          <ServiceAccountOwnerPicker orgId={bot.orgId} selected={draft} onChange={setDraft} />
          {save.error && (
            <ErrorAlert error={new Error(serviceAccountError(save.error))} fallback="" />
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                save.reset();
                setDraft(null);
              }}
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
            <Button type="submit" size="sm" disabled={draft.length === 0 || save.isPending}>
              <Check className="h-3.5 w-3.5" /> Save owners
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

function MembershipsCard({
  bot,
  orgSlug,
  canAdd,
  onAdded,
}: {
  bot: Detail;
  orgSlug: string;
  /** An org owner or admin, or a platform admin: the member and permission writes refuse most others */
  canAdd: boolean;
  onAdded: () => void;
}) {
  const [adding, setAdding] = useState<'team' | 'space' | null>(null);
  return (
    <Section
      title="Where it is"
      action={
        canAdd && (
          <div className="flex gap-1">
            <Button variant="ghost" size="xs" onClick={() => setAdding('team')}>
              <UserPlus className="h-3.5 w-3.5" /> Add to team
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setAdding('space')}>
              <BookOpen className="h-3.5 w-3.5" /> Add to space
            </Button>
          </div>
        )
      }
    >
      <p className="mb-3 text-xs text-text-tertiary">
        It can join a team or space one of its owners is in. Change its teams on each team&apos;s
        members page.
      </p>
      {bot.teams.length === 0 && bot.spaces.length === 0 ? (
        <p className="text-sm text-text-tertiary">In no team or space yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {bot.teams.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
              <Link to={`/${orgSlug}/${t.slug}/members`} className="text-primary hover:underline">
                {t.name}
              </Link>
              <Badge variant="outline" size="sm">
                Team {t.role.toLowerCase()}
              </Badge>
            </li>
          ))}
          {bot.spaces.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-text">{s.name}</span>
              <Badge variant="outline" size="sm">
                Space {s.level.toLowerCase()}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <AddPlaceModal
          kind={adding}
          bot={bot}
          onClose={() => setAdding(null)}
          onAdded={() => {
            setAdding(null);
            onAdded();
          }}
        />
      )}
    </Section>
  );
}

/** The roles a bot may have: at most member of a team, at most edit on a space */
const PLACE_ROLES = {
  team: [
    { value: 'MEMBER', label: 'Member' },
    { value: 'VIEWER', label: 'Viewer' },
  ],
  space: [
    { value: 'EDIT', label: 'Edit' },
    { value: 'VIEW', label: 'View' },
  ],
};

/**
 * Add a bot to a team or space, through the same member and permission actions as a person. What
 * it may join is read as the dialog opens: a read that costs a check per space of the org.
 * @param props - What is added where
 * @param props.kind - A team or a space
 * @param props.bot - The bot
 * @param props.onClose - Close without adding
 * @param props.onAdded - Called once it is added
 */
function AddPlaceModal({
  kind,
  bot,
  onClose,
  onAdded,
}: {
  kind: 'team' | 'space';
  bot: Detail;
  onClose: () => void;
  onAdded: () => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['service-account-joinable', bot.id],
    queryFn: () => serviceAccountsApi.joinable(bot.id),
  });
  const places =
    kind === 'team'
      ? (data?.teams ?? []).map((t) => ({ value: t.id, label: t.name }))
      : (data?.spaces ?? []).map((s) => ({ value: s.id, label: `${s.teamName} / ${s.name}` }));
  const [picked, setPicked] = useState('');
  const placeId = picked || places[0]?.value || '';
  const [role, setRole] = useState(PLACE_ROLES[kind][0].value);
  const add = useMutationWithToast(
    () =>
      kind === 'team'
        ? teamsApi.addMember(placeId, bot.id, role)
        : spacePermissionsApi.upsert(placeId, { userId: bot.id, level: role }),
    {
      successMessage: kind === 'team' ? 'Added to the team' : 'Added to the space',
      errorMessage: null,
      onSuccess: () => {
        // The team's members or the space's permissions show the bot from now on
        void queryClient.invalidateQueries({
          queryKey: [kind === 'team' ? 'team-members' : 'space-permissions', placeId],
        });
        void queryClient.invalidateQueries({ queryKey: ['service-account-joinable', bot.id] });
        onAdded();
      },
    },
  );
  return (
    <Modal open onClose={onClose} title={kind === 'team' ? 'Add to team' : 'Add to space'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (placeId) add.mutate();
        }}
      >
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : error ? (
          <ErrorAlert error={new Error(serviceAccountError(error))} fallback="" />
        ) : places.length === 0 ? (
          <p className="text-sm text-text-secondary">
            {kind === 'team'
              ? 'No team to add it to: it is in every team one of its owners is in.'
              : "No space to add it to. A space is offered when it has permissions set, it is a space one of this bot's owners can open, and the bot cannot open it yet."}
          </p>
        ) : (
          <>
            <Select
              label={kind === 'team' ? 'Team' : 'Space'}
              value={placeId}
              onChange={(v) => setPicked(v as string)}
              options={places}
            />
            <Select
              label={kind === 'team' ? 'Role' : 'Access'}
              value={role}
              onChange={(v) => setRole(v as string)}
              options={PLACE_ROLES[kind]}
            />
          </>
        )}
        {add.error && <ErrorAlert error={new Error(serviceAccountError(add.error))} fallback="" />}
        <ModalFooter>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!placeId || add.isPending}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function RequestsCard({ botId }: { botId: string }) {
  const { data } = useQuery({
    queryKey: ['agent-approvals', 'open'],
    queryFn: () => agentApprovalsApi.list({ state: 'open' }),
  });
  const requests = (data?.data ?? []).filter((r) => r.serviceAccount?.id === botId);
  return (
    <Section title="Waiting requests">
      {requests.length === 0 ? (
        <p className="text-sm text-text-tertiary">Nothing waits for you from this bot.</p>
      ) : (
        <ul className="space-y-1.5">
          {requests.map((r) => (
            <li key={r.id}>
              {r.restricted ? (
                // A stub has no page this owner may open, and nothing to decide
                <span className="inline-flex items-center gap-1.5 text-sm text-text-secondary">
                  <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />A request in a place
                  you can&apos;t open
                </span>
              ) : (
                <Link
                  to={`/approvals/agent/${r.id}`}
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {r.preview}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ActivityCard({ botId }: { botId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['service-account-activity', botId],
    queryFn: () => serviceAccountsApi.activity(botId),
  });
  return (
    <Section title="Recent activity">
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-text-tertiary">No activity you can see yet.</p>
      ) : (
        <ul className="divide-y divide-border-light">
          {data.map((a) => {
            const label = [a.resourceKey, a.resourceTitle].filter(Boolean).join(' ');
            return (
              <li key={a.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="text-text-secondary">
                    {ACTION_LABELS[a.action] ?? a.action.replace(/_/g, ' ')}
                  </span>{' '}
                  {a.resourceLink ? (
                    <Link to={a.resourceLink} className="text-primary hover:underline">
                      {label || a.resourceType.replace(/_/g, ' ')}
                    </Link>
                  ) : (
                    <span className="text-text-tertiary">
                      {label || `a ${a.resourceType.replace(/_/g, ' ')} that is gone`}
                    </span>
                  )}{' '}
                  <ViaLabel via={a.via} />
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-text-tertiary">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {formatRelative(a.createdAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
