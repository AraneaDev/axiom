/* eslint-disable react-refresh/only-export-components */
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, PauseCircle, UserX } from 'lucide-react';
import { useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import type { ServiceAccountSummary } from '@/api/service-accounts.api';
import { Badge } from '@/components/ui/Badge';
import { useAuthStore } from '@/stores/auth.store';

/**
 * The org of the page's `:org` slug, and whether the viewer manages its bots: an org OWNER or
 * ADMIN, or a platform admin. The server decides; this only hides what it would refuse.
 */
export function useOrgOfPage() {
  const { org: slug = '' } = useParams();
  const user = useAuthStore((s) => s.user);
  const { data: orgs, isLoading } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const org = orgs?.find((o) => o.slug === slug);
  const isAdmin = !!user?.isAdmin || org?.role === 'OWNER' || org?.role === 'ADMIN';
  return { slug, org, isAdmin, isLoading };
}

/**
 * Whether a bot lost its last owner: only a new owner resumes it
 * @param bot
 */
export function isOrphaned(bot: Pick<ServiceAccountSummary, 'status' | 'suspendedReason'>) {
  return bot.status === 'SUSPENDED' && bot.suspendedReason === 'ORPHANED';
}

/**
 * A bot's status: active, suspended by hand, or suspended with no owner.
 * @param props - The bot's status and reason
 * @param props.bot - The bot
 */
export function ServiceAccountStatusBadge({
  bot,
}: {
  bot: Pick<ServiceAccountSummary, 'status' | 'suspendedReason'>;
}) {
  if (bot.status === 'ACTIVE') {
    return (
      <Badge variant="success" size="sm">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        Active
      </Badge>
    );
  }
  if (isOrphaned(bot)) {
    return (
      <Badge variant="danger" size="sm">
        <UserX className="h-3 w-3" aria-hidden="true" />
        Suspended: no owner
      </Badge>
    );
  }
  return (
    <Badge variant="warning" size="sm">
      <PauseCircle className="h-3 w-3" aria-hidden="true" />
      Suspended
    </Badge>
  );
}
